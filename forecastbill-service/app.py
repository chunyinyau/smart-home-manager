import calendar
import os
import sys
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urljoin
from zoneinfo import ZoneInfo

import requests
from flask import Flask, jsonify, request
from flask_cors import CORS

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.append(str(PROJECT_ROOT))

try:
    from picoclaw.forecast import run_forecast_check
except Exception:
    run_forecast_check = None

from feasibility_policy import classify_feasibility
from recommendation_planner import get_ai_recommendation_adjustments


BILL_SERVICE_URL = os.getenv("BILL_SERVICE_URL", "http://bill_service:5003")
BUDGET_SERVICE_URL = os.getenv("BUDGET_SERVICE_URL", "http://budget_service:5004")
APPLIANCE_SERVICE_URL = os.getenv("APPLIANCE_SERVICE_URL", "http://appliance_service:5002")
PROFILE_SERVICE_URL = os.getenv(
    "PROFILE_SERVICE_URL",
    "https://personal-2nbikeej.outsystemscloud.com/Profile/rest/Profile/profile",
)
REQUEST_TIMEOUT_SECONDS = float(os.getenv("REQUEST_TIMEOUT_SECONDS", "8"))
DEFAULT_BILL_USER_ID = int(os.getenv("DEFAULT_BILL_USER_ID", "1"))
DEFAULT_FORECAST_UID = os.getenv("DEFAULT_FORECAST_UID", "user_demo_001")
DEFAULT_PROFILE_ID = os.getenv("DEFAULT_PROFILE_ID", "1")
DEFAULT_HDB_TYPE = os.getenv("DEFAULT_HDB_TYPE", "4")
DEFAULT_BASELINE_MONTHLY_KWH = float(os.getenv("DEFAULT_BASELINE_MONTHLY_KWH", "350"))
RECOMMENDATION_TARGET_BUFFER_RATIO = min(
    max(float(os.getenv("RECOMMENDATION_TARGET_BUFFER_RATIO", "0.03")), 0.0),
    0.1,
)
RECOMMENDATION_SAFETY_NET_MULTIPLIER = max(
    float(os.getenv("RECOMMENDATION_SAFETY_NET_MULTIPLIER", "1.15")),
    1.0,
)
RECOMMENDATION_MIN_BUFFER_SGD = max(float(os.getenv("RECOMMENDATION_MIN_BUFFER_SGD", "1.0")), 0.0)
SGT_TZ = ZoneInfo("Asia/Singapore")

SERVICE_FALLBACK_URLS = {
    "appliance": [
        APPLIANCE_SERVICE_URL,
        "http://host.docker.internal:5002",
        "http://127.0.0.1:5002",
        "http://localhost:5002",
    ],
    "bill": [
        BILL_SERVICE_URL,
        "http://host.docker.internal:5003",
        "http://127.0.0.1:5003",
        "http://localhost:5003",
    ],
    "budget": [
        BUDGET_SERVICE_URL,
        "http://host.docker.internal:5004",
        "http://127.0.0.1:5004",
        "http://localhost:5004",
    ],
}

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": ["http://localhost:3000", "http://127.0.0.1:3000"]}})


def normalize_base_url(base_url: str) -> str:
    return base_url.strip().rstrip("/")


def parse_positive_int(value: Any) -> Optional[int]:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None

    if parsed <= 0:
        return None

    return parsed


def iso_sgt_now() -> str:
    return datetime.now(SGT_TZ).isoformat()


def parse_non_negative_int(value: Any) -> Optional[int]:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None

    if parsed < 0:
        return None

    return parsed


def parse_float(value: Any) -> Optional[float]:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None

    if not (parsed == parsed) or parsed in (float("inf"), float("-inf")):
        return None

    return parsed


def month_key(date_value: datetime) -> str:
    return date_value.strftime("%Y-%m")


def iso_to_month_key(raw: str) -> Optional[str]:
    if not isinstance(raw, str) or len(raw.strip()) < 7:
        return None

    candidate = raw.strip()
    if len(candidate) >= 7:
        direct = candidate[:7]
        if direct[4:5] == "-" and direct.replace("-", "").isdigit():
            return direct

    try:
        parsed = datetime.fromisoformat(candidate.replace("Z", "+00:00"))
    except ValueError:
        return None

    return month_key(parsed)


def parse_iso_datetime(value: Any) -> Optional[datetime]:
    if not isinstance(value, str) or not value.strip():
        return None

    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None

    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)

    return parsed.astimezone(timezone.utc)


def parse_iso_date(value: Any) -> Optional[date]:
    if isinstance(value, date) and not isinstance(value, datetime):
        return value

    if isinstance(value, datetime):
        return value.date()

    if not isinstance(value, str) or not value.strip():
        return None

    candidate = value.strip()
    try:
        return date.fromisoformat(candidate[:10])
    except ValueError:
        return None


def derive_risk_level(projected_month_end_spend: float, budget_cap: float) -> str:
    if budget_cap <= 0:
        return "CRITICAL"

    ratio = projected_month_end_spend / budget_cap
    if ratio >= 1:
        return "CRITICAL"
    if ratio >= 0.85:
        return "HIGH"
    return "SAFE"


def calculate_days_to_exceed(
    budget_cap: float,
    current_spend: float,
    average_daily_spend: float,
) -> Optional[int]:
    if current_spend >= budget_cap:
        return 0

    if average_daily_spend <= 0:
        return None

    remaining_budget = budget_cap - current_spend
    days = int((remaining_budget / average_daily_spend) + 0.9999)
    return max(days, 0)


def household_recommendation_tokens(appliances: list[dict[str, Any]]) -> set[str]:
    tokens: set[str] = set()

    for appliance in appliances:
        name = str(appliance.get("name") or "").strip().lower()
        appliance_type = str(appliance.get("type") or "").strip().lower()

        if name:
            compact_name = "".join(ch for ch in name if ch.isalnum())
            if compact_name:
                tokens.add(compact_name)

            for part in name.replace("-", " ").split():
                compact_part = "".join(ch for ch in part if ch.isalnum())
                if len(compact_part) >= 4:
                    tokens.add(compact_part)

        if "tv" in name:
            tokens.update({"tv", "settopbox"})
        if "lamp" in name or "light" in name or appliance_type == "lighting":
            tokens.update({"lamp", "lights", "lighting"})
        if "air con" in name or "aircon" in name or appliance_type == "cooling":
            tokens.update({"aircon", "airconditioner", "ac", "cooling"})
        if "fridge" in name or appliance_type == "essential":
            tokens.update({"fridge", "refrigerator"})
        if "panel" in name or appliance_type == "infrastructure":
            tokens.update({"panel", "smartpanel", "distributionboard"})

    return tokens


def filter_recommendations_for_household(
    recommendations: list[str],
    appliances: list[dict[str, Any]],
) -> list[str]:
    if not recommendations:
        return []

    tokens = household_recommendation_tokens(appliances)
    if not tokens:
        return []

    filtered: list[str] = []
    for recommendation in recommendations:
        normalized = "".join(ch for ch in recommendation.lower() if ch.isalnum())
        if any(token in normalized for token in tokens):
            filtered.append(recommendation)

    return filtered


def fallback_recommendations(
    risk_level: str,
    appliances: list[dict[str, Any]],
) -> list[str]:
    blocked_types = {"essential", "infrastructure"}
    candidates = sorted(
        [
            appliance
            for appliance in appliances
            if str(appliance.get("state") or "").upper() == "ON"
            and str(appliance.get("type") or "").strip().lower() not in blocked_types
            and float(appliance.get("currentWatts") or 0) > 0
        ],
        key=lambda appliance: -float(appliance.get("currentWatts") or 0),
    )

    if not candidates:
        return [
            "All controllable appliances are already OFF. Turn appliances back ON only when needed.",
        ]

    limit = 3 if risk_level == "CRITICAL" else 2 if risk_level == "HIGH" else 1
    recommendations: list[str] = []

    for appliance in candidates[:limit]:
        name = str(appliance.get("name") or "Appliance")
        if risk_level == "CRITICAL":
            recommendations.append(f"{name}: keep OFF as long as possible during this billing window.")
        elif risk_level == "HIGH":
            recommendations.append(f"{name}: reduce runtime or switch OFF when not needed.")
        else:
            recommendations.append(f"{name}: keep usage efficient to maintain SAFE status.")

    return recommendations


def request_with_service_fallback(
    service: str,
    method: str,
    path: str,
    *,
    params: Optional[dict[str, Any]] = None,
    json_body: Optional[dict[str, Any]] = None,
) -> requests.Response:
    seen: set[str] = set()
    candidates: list[str] = []
    for url in SERVICE_FALLBACK_URLS[service]:
        normalized = normalize_base_url(url)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        candidates.append(normalized)

    last_error: Optional[Exception] = None
    for base_url in candidates:
        try:
            target = urljoin(f"{base_url}/", path.lstrip("/"))
            response = requests.request(
                method=method,
                url=target,
                params=params,
                json=json_body,
                timeout=REQUEST_TIMEOUT_SECONDS,
            )
            if is_untrusted_host_400(response):
                continue
            return response
        except requests.RequestException as error:
            last_error = error

    if last_error:
        raise last_error

    raise RuntimeError(f"Unable to reach {service}-service")


def extract_error_message(payload: Any, fallback: str) -> str:
    if isinstance(payload, dict):
        candidate = payload.get("error") or payload.get("message")
        if isinstance(candidate, str) and candidate.strip():
            return candidate
    return fallback


def is_untrusted_host_400(response: requests.Response) -> bool:
    if response.status_code != 400:
        return False

    body = response.text or ""
    return "is not trusted" in body and "Host" in body


def get_response_json(response: requests.Response) -> Any:
    try:
        return response.json()
    except ValueError:
        return None


def fetch_budget_snapshot(user_id: int) -> tuple[float, float]:
    response = request_with_service_fallback("budget", "GET", f"/api/budget/{user_id}")
    payload = get_response_json(response)

    if response.status_code != 200:
        raise RuntimeError(
            extract_error_message(payload, f"budget-service returned HTTP {response.status_code}")
        )

    if not isinstance(payload, dict) or not isinstance(payload.get("data"), dict):
        raise RuntimeError("budget-service returned an invalid payload")

    data = payload["data"]
    budget_cap = parse_float(data.get("budget_cap"))
    last_month_cumulative_bill = parse_float(data.get("cum_bill"))

    if budget_cap is None or budget_cap < 0:
        raise RuntimeError("budget-service budget_cap is invalid")

    if last_month_cumulative_bill is None:
        raise RuntimeError("budget-service cum_bill is invalid")

    return round(budget_cap, 2), round(last_month_cumulative_bill, 2)


def fetch_appliance_snapshot(uid: str) -> list[dict[str, Any]]:
    response = request_with_service_fallback(
        "appliance",
        "GET",
        "/api/appliance",
        params={"uid": uid},
    )
    payload = get_response_json(response)

    if response.status_code != 200:
        raise RuntimeError(
            extract_error_message(payload, f"appliance-service returned HTTP {response.status_code}")
        )

    if not isinstance(payload, list):
        return []
    return [item for item in payload if isinstance(item, dict)]


def month_end_boundary_utc(period_start: date) -> datetime:
    if period_start.month == 12:
        return datetime(period_start.year + 1, 1, 1, tzinfo=timezone.utc)
    return datetime(period_start.year, period_start.month + 1, 1, tzinfo=timezone.utc)


def estimate_active_override_savings(
    appliances: list[dict[str, Any]],
    now_utc: datetime,
    period_start: date,
    price_per_kwh: float,
) -> dict[str, Any]:
    savings_kwh = 0.0
    savings_sgd = 0.0
    month_end_utc = month_end_boundary_utc(period_start)
    devices: list[dict[str, Any]] = []

    for appliance in appliances:
        override = appliance.get("manualOverride")
        if not isinstance(override, dict):
            continue

        state = str(override.get("state") or "").upper()
        active = bool(override.get("active"))
        if state != "OFF" or not active:
            continue

        watts_estimate = parse_float(appliance.get("manualOverrideWattsEstimate"))
        if watts_estimate is None or watts_estimate <= 0:
            continue

        override_until = parse_iso_datetime(override.get("until"))
        if override_until is None:
            effective_end = month_end_utc
        else:
            effective_end = min(override_until, month_end_utc)

        if effective_end <= now_utc:
            continue

        remaining_hours = max((effective_end - now_utc).total_seconds() / 3600.0, 0.0)
        if remaining_hours <= 0:
            continue

        saved_kwh = (watts_estimate * remaining_hours) / 1000.0
        saved_sgd = saved_kwh * max(price_per_kwh, 0.0)
        savings_kwh += saved_kwh
        savings_sgd += saved_sgd

        devices.append(
            {
                "applianceId": appliance.get("id"),
                "name": appliance.get("name"),
                "wattsEstimate": round(watts_estimate, 2),
                "overrideUntil": override.get("until"),
                "remainingHours": round(remaining_hours, 3),
                "savedKwh": round(saved_kwh, 4),
                "savedSgd": round(saved_sgd, 4),
            }
        )

    return {
        "estimatedSavedKwh": round(savings_kwh, 4),
        "estimatedSavedSgd": round(savings_sgd, 4),
        "activeOverrides": devices,
    }


def fetch_profile_snapshot(profile_id: str) -> dict[str, Any]:
    safe_profile_id = (profile_id or "").strip() or DEFAULT_PROFILE_ID
    endpoint = f"{normalize_base_url(PROFILE_SERVICE_URL)}/{safe_profile_id}/"

    try:
        response = requests.get(
            endpoint,
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
    except requests.RequestException as error:
        print(f"ForecastBill profile fallback activated (network): {error}", flush=True)
        return {
            "profileId": safe_profile_id,
            "hdbType": DEFAULT_HDB_TYPE,
            "baselineMonthlyKwh": round(DEFAULT_BASELINE_MONTHLY_KWH, 2),
            "source": "fallback",
        }

    payload = get_response_json(response)
    if response.status_code != 200:
        print(
            f"ForecastBill profile fallback activated (HTTP {response.status_code})",
            flush=True,
        )
        return {
            "profileId": safe_profile_id,
            "hdbType": DEFAULT_HDB_TYPE,
            "baselineMonthlyKwh": round(DEFAULT_BASELINE_MONTHLY_KWH, 2),
            "source": "fallback",
        }

    profile_data: Optional[dict[str, Any]] = None
    if isinstance(payload, dict):
        if isinstance(payload.get("data"), dict):
            profile_data = payload["data"]
        elif all(k in payload for k in ("hdb_type", "baseline_monthly_kwh")):
            profile_data = payload

    if profile_data is None:
        return {
            "profileId": safe_profile_id,
            "hdbType": DEFAULT_HDB_TYPE,
            "baselineMonthlyKwh": round(DEFAULT_BASELINE_MONTHLY_KWH, 2),
            "source": "fallback",
        }

    hdb_type_raw = profile_data.get("hdb_type")
    hdb_type = str(hdb_type_raw).strip() if hdb_type_raw is not None else DEFAULT_HDB_TYPE
    baseline_monthly_kwh = parse_float(profile_data.get("baseline_monthly_kwh"))
    if baseline_monthly_kwh is None or baseline_monthly_kwh <= 0:
        baseline_monthly_kwh = DEFAULT_BASELINE_MONTHLY_KWH

    return {
        "profileId": safe_profile_id,
        "hdbType": hdb_type,
        "baselineMonthlyKwh": round(baseline_monthly_kwh, 2),
        "source": "profile-service",
    }


def fetch_user_bill_history(user_id: int) -> list[dict[str, Any]]:
    response = request_with_service_fallback("bill", "GET", "/api/bills")
    payload = get_response_json(response)

    if response.status_code != 200:
        raise RuntimeError(
            extract_error_message(payload, f"bill-service returned HTTP {response.status_code}")
        )

    if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
        return []

    normalized: list[dict[str, Any]] = []
    for record in payload["data"]:
        if not isinstance(record, dict):
            continue

        if parse_positive_int(record.get("user_id")) != user_id:
            continue

        computed_at_raw = record.get("computed_at")
        billing_period_start_raw = record.get("billing_period_start")
        computed_at = parse_iso_datetime(computed_at_raw)
        billing_period_start = parse_iso_date(billing_period_start_raw)

        bill_id = parse_positive_int(record.get("bill_id"))
        period_cost_sgd = parse_float(record.get("period_cost_sgd"))
        period_kwh = parse_float(record.get("period_kwh"))

        if (
            bill_id is None
            or period_cost_sgd is None
            or period_kwh is None
            or computed_at is None
            or billing_period_start is None
        ):
            continue

        normalized.append(
            {
                "billId": bill_id,
                "periodCostSgd": round(period_cost_sgd, 4),
                "periodKwh": round(period_kwh, 4),
                "computedAt": computed_at.isoformat().replace("+00:00", "Z"),
                "computedAtDt": computed_at,
                "billingPeriodStart": billing_period_start.isoformat(),
                "billingPeriodStartDate": billing_period_start,
            }
        )

    normalized.sort(
        key=lambda row: (
            row.get("billingPeriodStartDate") or date.min,
            row.get("computedAtDt") or datetime.min.replace(tzinfo=timezone.utc),
        )
    )
    return normalized


def resolve_current_period_start(
    history: list[dict[str, Any]],
    now_utc: datetime,
) -> date:
    dates = [
        item.get("billingPeriodStartDate")
        for item in history
        if isinstance(item.get("billingPeriodStartDate"), date)
    ]
    if dates:
        return max(dates)
    return date(now_utc.year, now_utc.month, 1)


def filter_history_by_period(
    history: list[dict[str, Any]],
    period_start: date,
) -> list[dict[str, Any]]:
    return [
        item
        for item in history
        if item.get("billingPeriodStartDate") == period_start
    ]


def to_public_history(history: list[dict[str, Any]]) -> list[dict[str, Any]]:
    public_rows: list[dict[str, Any]] = []
    for item in history:
        public_rows.append(
            {
                "billId": item.get("billId"),
                "periodCostSgd": item.get("periodCostSgd"),
                "periodKwh": item.get("periodKwh"),
                "computedAt": item.get("computedAt"),
                "billingPeriodStart": item.get("billingPeriodStart"),
            }
        )
    return public_rows


def fallback_short_narrative(risk_level: str, projected_month_end_spend: float, budget_cap: float) -> str:
    delta = abs(projected_month_end_spend - budget_cap)

    if risk_level == "CRITICAL":
        return (
            f"Projected spend is {delta:.2f} SGD above budget. "
            "Reduce high-drain usage this week to avoid overrun."
        )

    if risk_level == "HIGH":
        return "Projected spend is close to the monthly cap. Keep daily usage steady to stay within budget."

    return (
        "Projected spend is within budget with buffer. "
        f"Estimated month-end spend remains {delta:.2f} SGD under cap."
    )


def normalize_recommendations(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []

    cleaned: list[str] = []
    seen: set[str] = set()
    for item in value:
        if not isinstance(item, str):
            continue
        candidate = item.strip()
        if len(candidate) < 4:
            continue
        key = candidate.lower()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(candidate)
    return cleaned


def normalize_ai_assessment(payload: Any, fallback: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return fallback

    normalized = dict(fallback)

    risk_level = payload.get("risk_level")
    if isinstance(risk_level, str) and risk_level.upper() in {"SAFE", "HIGH", "CRITICAL"}:
        normalized["riskLevel"] = risk_level.upper()

    days_to_exceed = payload.get("days_to_exceed")
    if days_to_exceed is None:
        normalized["daysToExceed"] = None
    else:
        parsed_days = parse_non_negative_int(days_to_exceed)
        if parsed_days is not None:
            normalized["daysToExceed"] = parsed_days

    short_narrative = payload.get("short_narrative")
    if isinstance(short_narrative, str) and len(short_narrative.strip()) >= 8:
        normalized["shortNarrative"] = short_narrative.strip()

    projected_cost = parse_float(payload.get("projected_month_end_cost"))
    if projected_cost is not None and projected_cost >= 0:
        normalized["projectedCost"] = round(projected_cost, 2)

    projected_kwh = parse_float(payload.get("projected_month_end_kwh"))
    if projected_kwh is not None and projected_kwh >= 0:
        normalized["projectedKwh"] = round(projected_kwh, 2)

    recommendations = normalize_recommendations(payload.get("recommended_appliances"))
    if recommendations:
        normalized["recommendedAppliances"] = recommendations

    model = payload.get("model")
    if isinstance(model, dict):
        normalized["model"] = model

    return normalized


def resolve_picoclaw_api_key() -> Optional[str]:
    api_key = os.getenv("PICOCLAW_API_KEY") or os.getenv("OPENAI_API_KEY")
    if isinstance(api_key, str) and api_key.strip():
        return api_key.strip()

    return None


def get_ai_assessment(
    ai_input: dict[str, Any],
    fallback: dict[str, Any],
) -> dict[str, Any]:
    if run_forecast_check is None:
        print("ForecastBill PicoClaw disabled: helper unavailable", flush=True)
        return fallback

    try:
        api_key = resolve_picoclaw_api_key()
        if api_key:
            print("ForecastBill PicoClaw request starting", flush=True)
        else:
            print("ForecastBill PicoClaw request starting; key=not-set (local mode)", flush=True)
        result = run_forecast_check(ai_input)
        assessment = normalize_ai_assessment(
            result.get("assessment") if isinstance(result, dict) else None,
            fallback,
        )
        print("ForecastBill PicoClaw request completed successfully", flush=True)
        return assessment
    except Exception as error:
        print(f"ForecastBill PicoClaw fallback activated: {error}", flush=True)
        return fallback


def build_forecast(uid: str, user_id: int, profile_id: str) -> dict[str, Any]:
    now_utc = datetime.now(timezone.utc)
    all_history = fetch_user_bill_history(user_id)
    current_period_start = resolve_current_period_start(all_history, now_utc)
    current_period_history = filter_history_by_period(all_history, current_period_start)

    current_month = current_period_start.strftime("%Y-%m")
    budget_cap, current_cumulative_bill = fetch_budget_snapshot(user_id)
    profile = fetch_profile_snapshot(profile_id)

    current_period_total_cost = round(
        sum(float(entry["periodCostSgd"]) for entry in current_period_history),
        4,
    )
    current_period_total_kwh = round(
        sum(float(entry["periodKwh"]) for entry in current_period_history),
        4,
    )

    days_in_month = calendar.monthrange(current_period_start.year, current_period_start.month)[1]
    elapsed_days = max(1, min((now_utc.date() - current_period_start).days + 1, days_in_month))
    days_remaining = max(days_in_month - elapsed_days, 0)

    current_average_daily_spend = round(current_period_total_cost / elapsed_days, 4)
    baseline_monthly_kwh = float(profile["baselineMonthlyKwh"])
    fallback_average_daily_kwh = baseline_monthly_kwh / max(days_in_month, 1)
    current_average_daily_kwh = (
        round(current_period_total_kwh / elapsed_days, 4)
        if current_period_total_kwh > 0
        else round(fallback_average_daily_kwh, 4)
    )

    projected_month_end_spend = max(
        round(current_period_total_cost, 2),
        round(current_average_daily_spend * days_in_month, 2),
    )
    projected_month_end_kwh = max(
        round(current_period_total_kwh, 2),
        round(current_average_daily_kwh * days_in_month, 2),
    )

    appliance_snapshot = fetch_appliance_snapshot(uid)
    implied_price_per_kwh = (
        (projected_month_end_spend / projected_month_end_kwh)
        if projected_month_end_kwh > 0
        else 0.0
    )
    override_adjustment = estimate_active_override_savings(
        appliance_snapshot,
        now_utc,
        current_period_start,
        implied_price_per_kwh,
    )

    projected_month_end_spend = round(
        max(projected_month_end_spend - float(override_adjustment["estimatedSavedSgd"]), current_period_total_cost),
        2,
    )
    projected_month_end_kwh = round(
        max(projected_month_end_kwh - float(override_adjustment["estimatedSavedKwh"]), current_period_total_kwh),
        2,
    )

    suggested_days_to_exceed = calculate_days_to_exceed(
        budget_cap,
        current_period_total_cost,
        current_average_daily_spend,
    )

    fallback_risk_level = derive_risk_level(projected_month_end_spend, budget_cap)
    fallback_recommended = fallback_recommendations(fallback_risk_level, appliance_snapshot)
    fallback_assessment = {
        "projectedCost": projected_month_end_spend,
        "projectedKwh": projected_month_end_kwh,
        "riskLevel": fallback_risk_level,
        "daysToExceed": suggested_days_to_exceed,
        "shortNarrative": fallback_short_narrative(
            fallback_risk_level,
            projected_month_end_spend,
            budget_cap,
        ),
        "recommendedAppliances": fallback_recommended,
        "model": {
            "method": "average_daily_projection",
            "pointsUsed": len(current_period_history),
            "daysElapsed": elapsed_days,
        },
    }

    public_history = to_public_history(current_period_history)
    ai_input = {
        "uid": uid,
        "user_id": user_id,
        "month": current_month,
        "billing_period_start": current_period_start.isoformat(),
        "days_elapsed": elapsed_days,
        "daysRemaining": days_remaining,
        "billing": {
            "current_period_history": public_history,
            "current_period_total_cost": current_period_total_cost,
            "current_period_total_kwh": current_period_total_kwh,
            "history_count": len(public_history),
        },
        "budget": {
            "budget_cap": budget_cap,
            "cum_bill": current_cumulative_bill,
        },
        "profile": {
            "profile_id": str(profile["profileId"]),
            "hdb_type": str(profile["hdbType"]),
            "baseline_monthly_kwh": baseline_monthly_kwh,
        },
        "fallback_projection": {
            "projected_month_end_cost": projected_month_end_spend,
            "projected_month_end_kwh": projected_month_end_kwh,
            "risk_level": fallback_risk_level,
            "days_to_exceed": suggested_days_to_exceed,
        },
    }

    assessment = get_ai_assessment(ai_input, fallback_assessment)
    assessment["recommendedAppliances"] = fallback_recommended

    ai_projected_cost = round(float(assessment["projectedCost"]), 2)
    ai_projected_kwh = round(float(assessment["projectedKwh"]), 2)

    adjusted_projected_cost = round(
        max(ai_projected_cost - float(override_adjustment["estimatedSavedSgd"]), current_period_total_cost),
        2,
    )
    adjusted_projected_kwh = round(
        max(ai_projected_kwh - float(override_adjustment["estimatedSavedKwh"]), current_period_total_kwh),
        2,
    )

    adjusted_risk_level = derive_risk_level(adjusted_projected_cost, budget_cap)
    narrative = str(assessment.get("shortNarrative") or "").strip()
    if float(override_adjustment["estimatedSavedSgd"]) > 0:
        narrative = (
            f"{narrative} Active manual overrides reduce projected spend by approximately "
            f"${float(override_adjustment['estimatedSavedSgd']):.2f}."
        ).strip()

    days_to_exceed_adjusted = calculate_days_to_exceed(
        budget_cap,
        current_period_total_cost,
        max((adjusted_projected_cost - current_period_total_cost) / max(days_remaining, 1), 0.0),
    )

    effective_price_per_kwh = round(
        adjusted_projected_cost / adjusted_projected_kwh,
        6,
    ) if adjusted_projected_kwh > 0 else 0.0

    return {
        "uid": uid,
        "userId": user_id,
        "month": current_month,
        "billingPeriodStart": current_period_start.isoformat(),
        "generatedAt": iso_sgt_now(),
        "projectedKwh": adjusted_projected_kwh,
        "projectedCost": adjusted_projected_cost,
        "reasoning": narrative,
        "riskLevel": adjusted_risk_level,
        "daysToExceed": days_to_exceed_adjusted,
        "shortNarrative": narrative,
        "recommendedAppliances": assessment["recommendedAppliances"],
        "recommendations": assessment["recommendedAppliances"],
        "model": assessment.get("model"),
        "overrideAdjustment": override_adjustment,
        "billing": {
            "currentPeriodHistory": public_history,
            "currentPeriodTotalCost": round(current_period_total_cost, 2),
            "currentPeriodTotalKwh": round(current_period_total_kwh, 2),
            "daysElapsed": elapsed_days,
            "daysRemaining": days_remaining,
            # Compatibility aliases for existing UI/types.
            "sameMonthSpendHistory": public_history,
            "sameMonthSpendTotal": round(current_period_total_cost, 2),
            "sameMonthAverageDailySpend": round(current_average_daily_spend, 2),
        },
        "budget": {
            "budgetCap": budget_cap,
            "currentCumulativeBill": current_cumulative_bill,
            "lastMonthCumulativeBill": current_cumulative_bill,
        },
        "profile": {
            "profileId": str(profile["profileId"]),
            "hdbType": str(profile["hdbType"]),
            "baselineMonthlyKwh": baseline_monthly_kwh,
            "source": profile["source"],
        },
        "rate": {
            "monthYear": current_month,
            "centsPerKwh": round(effective_price_per_kwh * 100.0, 4),
            "pricePerKwh": effective_price_per_kwh,
        },
    }


@app.route("/", methods=["GET"])
def home() -> Any:
    return jsonify(
        {
            "status": "online",
            "service": "ForecastBill Composite Microservice",
            "endpoints": [
                "GET /api/forecast",
                "POST /api/forecast",
                "POST /api/forecastbill",
                "GET /api/forecast/recommendation",
                "POST /api/forecast/recommendation",
            ],
        }
    )


def resolve_request_context() -> tuple[str, int, str]:
    payload = request.get_json(silent=True) if request.method == "POST" else None

    uid_raw = (
        (payload or {}).get("uid")
        if isinstance(payload, dict)
        else None
    )
    uid_raw = uid_raw or request.args.get("uid") or request.args.get("user_id")
    uid = str(uid_raw or DEFAULT_FORECAST_UID)

    user_id_raw = (
        (payload or {}).get("user_id")
        if isinstance(payload, dict)
        else None
    )
    user_id_raw = user_id_raw or request.args.get("user_id")
    user_id = parse_positive_int(user_id_raw) or parse_positive_int(uid) or DEFAULT_BILL_USER_ID

    profile_id_raw = (
        (payload or {}).get("profile_id")
        if isinstance(payload, dict)
        else None
    )
    profile_id_raw = profile_id_raw or request.args.get("profile_id") or str(user_id)
    profile_id = str(profile_id_raw or DEFAULT_PROFILE_ID)

    return uid, user_id, profile_id


def handle_forecast_request() -> Any:
    uid, user_id, profile_id = resolve_request_context()

    try:
        return jsonify(build_forecast(uid, user_id, profile_id)), 200
    except requests.RequestException as error:
        return (
            jsonify(
                {
                    "error": "Downstream microservice is unreachable",
                    "details": str(error),
                }
            ),
            503,
        )
    except RuntimeError as error:
        return jsonify({"error": str(error)}), 502
    except Exception as error:
        return jsonify({"error": "Failed to generate forecast", "details": str(error)}), 500


def build_recommendation_plan(uid: str, user_id: int, profile_id: str) -> dict[str, Any]:
    forecast = build_forecast(uid, user_id, profile_id)
    appliances = fetch_appliance_snapshot(uid)
    cron_gap_buffer_minutes = 15

    active = [
        appliance
        for appliance in appliances
        if str(appliance.get("state", "")).upper() == "ON"
    ]

    risk_level = str(forecast.get("riskLevel") or "SAFE").upper()

    blocked_types = {"essential", "infrastructure"}
    blocked_name_tokens = {"fridge", "refrigerator", "smart panel", "main panel", "distribution board"}
    min_watts_for_shutdown = 50.0

    def is_shutdown_recommendable(appliance: dict[str, Any], min_watts: float) -> bool:
        appliance_type = str(appliance.get("type") or "").strip().lower()
        appliance_name = str(appliance.get("name") or "").strip().lower()
        watts = max(0.0, float(appliance.get("currentWatts") or 0))

        if appliance_type in blocked_types:
            return False
        if any(token in appliance_name for token in blocked_name_tokens):
            return False
        if watts < min_watts:
            return False

        return True

    min_duration_by_risk = {
        "CRITICAL": 240,
        "HIGH": 180,
        "SAFE": 45,
    }
    max_devices_by_risk = {
        "CRITICAL": 3,
        "HIGH": 2,
        "SAFE": 1,
    }
    max_devices_with_safety_net_by_risk = {
        "CRITICAL": 5,
        "HIGH": 4,
        "SAFE": 2,
    }
    max_duration_by_risk = {
        "CRITICAL": 1440,
        "HIGH": 720,
        "SAFE": 180,
    }

    duration_minutes = min_duration_by_risk.get(risk_level, 30)
    max_devices = max_devices_by_risk.get(risk_level, 1)
    max_duration_minutes = max_duration_by_risk.get(risk_level, 1440)

    def max_duration_for_appliance(appliance: dict[str, Any]) -> int:
        appliance_type = str(appliance.get("type") or "").strip().lower()
        priority = int(appliance.get("priority") or 99)
        cap = max_duration_minutes

        # Keep long-duration actions justifiable by limiting sensitive loads.
        if appliance_type == "cooling":
            cap = min(cap, 720 if risk_level == "CRITICAL" else 540)
        elif appliance_type == "lighting":
            cap = min(cap, 960)

        if priority <= 1:
            cap = min(cap, 480 if risk_level == "CRITICAL" else 360)
        elif priority == 2:
            cap = min(cap, 720 if risk_level == "CRITICAL" else 540)

        return max(30, cap)

    price_per_kwh = float(((forecast.get("rate") or {}).get("pricePerKwh") or 0) or 0)
    projected_cost = float(forecast.get("projectedCost") or 0)
    budget_cap = float(((forecast.get("budget") or {}).get("budgetCap") or 0) or 0)

    safe_threshold_ratio = 0.85
    target_threshold_ratio = max(safe_threshold_ratio - RECOMMENDATION_TARGET_BUFFER_RATIO, 0.7)
    safe_ratio = safe_threshold_ratio if safe_threshold_ratio > 0 else 0.85
    safe_minimum_budget_cap = max((projected_cost + 0.01) / safe_ratio, 0.0)

    safe_target_cost = (budget_cap * safe_threshold_ratio) - 0.01 if budget_cap > 0 else projected_cost
    target_cost_with_safety_net = (
        (budget_cap * target_threshold_ratio) - 0.01 if budget_cap > 0 else projected_cost
    )

    required_savings_for_safe = 0.0
    required_savings_for_safety_net = 0.0
    if risk_level in {"HIGH", "CRITICAL"}:
        required_savings_for_safe = max(projected_cost - safe_target_cost, 0.0)
        required_savings_for_safety_net = max(projected_cost - target_cost_with_safety_net, 0.0)
        required_savings_for_safety_net = max(
            required_savings_for_safety_net,
            required_savings_for_safe * RECOMMENDATION_SAFETY_NET_MULTIPLIER,
            required_savings_for_safe + RECOMMENDATION_MIN_BUFFER_SGD,
        )

    recommendable_active = [
        appliance
        for appliance in active
        if is_shutdown_recommendable(appliance, min_watts_for_shutdown)
    ]

    # If strict filtering yields no actions in HIGH/CRITICAL, relax only the watt threshold.
    if not recommendable_active and risk_level in {"HIGH", "CRITICAL"}:
        recommendable_active = [
            appliance
            for appliance in active
            if is_shutdown_recommendable(appliance, 1.0)
        ]

    feasibility = classify_feasibility(
        projected_cost=projected_cost,
        budget_cap=budget_cap,
        safe_threshold_ratio=safe_threshold_ratio,
        required_savings_for_safe=required_savings_for_safe,
        price_per_kwh=price_per_kwh,
        recommendable_active=recommendable_active,
        max_duration_minutes=max_duration_minutes,
        target_threshold_ratio=target_threshold_ratio,
        required_savings_for_target=required_savings_for_safety_net,
    )

    if risk_level == "SAFE":
        return {
            "uid": uid,
            "userId": user_id,
            "generatedAt": iso_sgt_now(),
            "currentRiskLevel": risk_level,
            "predictedRiskLevel": "SAFE",
            "currentProjectedCost": round(projected_cost, 2),
            "projectedCostAfterPlan": round(projected_cost, 2),
            "estimatedTotalSavingsSgd": 0.0,
            "recommendedDurationMinutes": 0,
            "recommendations": [],
            "target": {
                "targetRiskLevel": "SAFE",
                "requiredSavingsForSafeSgd": 0.0,
                "remainingSavingsForSafeSgd": 0.0,
                "requiredSavingsForSafetyNetSgd": 0.0,
                "remainingSavingsForSafetyNetSgd": 0.0,
                "safeThresholdRatio": round(safe_ratio, 4),
                "safeMinimumBudgetCap": round(safe_minimum_budget_cap, 2),
                "targetSafetyThresholdRatio": round(target_threshold_ratio, 4),
                "met": True,
                "metSafetyNet": True,
                "feasibilityStatus": feasibility["status"],
                "feasibleWithCurrentBudget": feasibility["feasibleWithCurrentBudget"],
                "maxPotentialSavingsSgd": feasibility["maxPotentialSavingsSgd"],
                "conservativePotentialSavingsSgd": feasibility["conservativePotentialSavingsSgd"],
                "easyPotentialSavingsSgd": feasibility["easyPotentialSavingsSgd"],
                "feasibilityGapSgd": feasibility["feasibilityGapSgd"],
                "feasibleMinBudgetCap": feasibility["feasibleMinBudgetCap"],
                "nearestFeasibleBudgetCap": feasibility["nearestFeasibleBudgetCap"],
                "recommendedBudgetCapRange": feasibility["recommendedBudgetCapRange"],
            },
            "aiHints": forecast.get("recommendations") or forecast.get("recommendedAppliances") or [],
            "strategy": "no-action-safe-feasibility-aware",
        }

    ai_planner = get_ai_recommendation_adjustments(
        uid=uid,
        risk_level=risk_level,
        projected_cost=projected_cost,
        budget_cap=budget_cap,
        required_savings_for_safe=required_savings_for_safety_net,
        price_per_kwh=price_per_kwh,
        max_devices=max_devices,
        default_duration_minutes=duration_minutes,
        candidates=recommendable_active,
    )
    ai_scores = ai_planner.get("scores") if isinstance(ai_planner.get("scores"), dict) else {}
    ai_duration_multipliers = (
        ai_planner.get("durationMultipliers")
        if isinstance(ai_planner.get("durationMultipliers"), dict)
        else {}
    )

    ranked = sorted(
        recommendable_active,
        key=lambda appliance: (
            -float(ai_scores.get(str(appliance.get("id") or ""), -1.0)),
            -float(appliance.get("currentWatts") or 0),
            int(appliance.get("priority") or 99),
        ),
    )

    selected: list[dict[str, Any]] = []
    selected_max_potential = 0.0
    max_devices_with_safety_net = max_devices_with_safety_net_by_risk.get(risk_level, max_devices)

    for appliance in ranked:
        if len(selected) >= max_devices_with_safety_net:
            break

        selected.append(appliance)
        watts = max(0.0, float(appliance.get("currentWatts") or 0))
        appliance_cap_minutes = max_duration_for_appliance(appliance)
        selected_max_potential += ((watts * (appliance_cap_minutes / 60.0)) / 1000.0) * price_per_kwh

        # Keep at least the default count, then include extra only if safety-net savings are still short.
        if len(selected) >= max_devices and selected_max_potential >= required_savings_for_safety_net:
            break

    plan_items: list[dict[str, Any]] = []
    total_savings = 0.0
    remaining_savings_for_plan = required_savings_for_safety_net

    for appliance in selected:
        appliance_id = str(appliance.get("id") or "")
        watts = max(0.0, float(appliance.get("currentWatts") or 0))
        if watts <= 0:
            continue
        appliance_max_duration_minutes = max_duration_for_appliance(appliance)

        savings_per_minute = 0.0
        if price_per_kwh > 0:
            savings_per_minute = ((watts / 1000.0) * price_per_kwh) / 60.0

        suggested_duration_minutes = duration_minutes + cron_gap_buffer_minutes
        if remaining_savings_for_plan > 0 and savings_per_minute > 0:
            required_minutes = int((remaining_savings_for_plan / savings_per_minute) + 0.9999)
            required_minutes += cron_gap_buffer_minutes
            suggested_duration_minutes = max(suggested_duration_minutes, required_minutes)

        duration_multiplier = parse_float(ai_duration_multipliers.get(appliance_id))
        if duration_multiplier is not None:
            suggested_duration_minutes = int((suggested_duration_minutes * duration_multiplier) + 0.9999)

        suggested_duration_minutes = max(1, min(suggested_duration_minutes, appliance_max_duration_minutes))

        saved_kwh = (watts * (suggested_duration_minutes / 60.0)) / 1000.0
        saved_sgd = round(saved_kwh * price_per_kwh, 4)
        total_savings += saved_sgd
        remaining_savings_for_plan = max(required_savings_for_safety_net - total_savings, 0.0)

        plan_item = {
            "applianceId": appliance_id,
            "name": appliance.get("name"),
            "currentWatts": int(watts),
            "priority": appliance.get("priority"),
            "suggestedDurationMinutes": suggested_duration_minutes,
            "estimatedSavingsSgd": saved_sgd,
        }
        ai_score = parse_float(ai_scores.get(appliance_id))
        if ai_score is not None:
            plan_item["aiScore"] = round(ai_score, 2)
        if duration_multiplier is not None:
            plan_item["aiDurationMultiplier"] = round(duration_multiplier, 3)

        plan_items.append(plan_item)

        if remaining_savings_for_plan <= 0 and risk_level in {"HIGH", "CRITICAL"}:
            break

    adjusted_projected_cost = round(max(projected_cost - total_savings, 0.0), 2)
    predicted_risk = derive_risk_level(adjusted_projected_cost, budget_cap)
    remaining_savings_for_safe = max(required_savings_for_safe - total_savings, 0.0)
    recommended_duration_minutes = max(
        (int(item.get("suggestedDurationMinutes") or duration_minutes) for item in plan_items),
        default=duration_minutes,
    )

    return {
        "uid": uid,
        "userId": user_id,
        "generatedAt": iso_sgt_now(),
        "currentRiskLevel": forecast.get("riskLevel"),
        "predictedRiskLevel": predicted_risk,
        "currentProjectedCost": round(projected_cost, 2),
        "projectedCostAfterPlan": adjusted_projected_cost,
        "estimatedTotalSavingsSgd": round(total_savings, 4),
        "recommendedDurationMinutes": recommended_duration_minutes,
        "recommendations": plan_items,
        "target": {
            "targetRiskLevel": "SAFE",
            "requiredSavingsForSafeSgd": round(required_savings_for_safe, 4),
            "remainingSavingsForSafeSgd": round(remaining_savings_for_safe, 4),
            "requiredSavingsForSafetyNetSgd": round(required_savings_for_safety_net, 4),
            "remainingSavingsForSafetyNetSgd": round(remaining_savings_for_plan, 4),
            "safeThresholdRatio": round(safe_ratio, 4),
            "safeMinimumBudgetCap": round(safe_minimum_budget_cap, 2),
            "targetSafetyThresholdRatio": round(target_threshold_ratio, 4),
            "met": predicted_risk == "SAFE",
            "metSafetyNet": remaining_savings_for_plan <= 0,
            "feasibilityStatus": feasibility["status"],
            "feasibleWithCurrentBudget": feasibility["feasibleWithCurrentBudget"],
            "maxPotentialSavingsSgd": feasibility["maxPotentialSavingsSgd"],
            "conservativePotentialSavingsSgd": feasibility["conservativePotentialSavingsSgd"],
            "easyPotentialSavingsSgd": feasibility["easyPotentialSavingsSgd"],
            "feasibilityGapSgd": feasibility["feasibilityGapSgd"],
            "feasibleMinBudgetCap": feasibility["feasibleMinBudgetCap"],
            "nearestFeasibleBudgetCap": feasibility["nearestFeasibleBudgetCap"],
            "recommendedBudgetCapRange": feasibility["recommendedBudgetCapRange"],
        },
        "aiPlanner": {
            "used": bool(ai_planner.get("used")),
            "model": ai_planner.get("model"),
            "reason": ai_planner.get("reason"),
            "candidateCount": ai_planner.get("candidateCount", 0),
        },
        "aiHints": forecast.get("recommendations") or forecast.get("recommendedAppliances") or [],
        "strategy": (
            "ai-ranked-feasibility-aware-target"
            if bool(ai_planner.get("used"))
            else (
                "feasibility-aware-target-low-watt-fallback"
                if not [
                    appliance
                    for appliance in active
                    if is_shutdown_recommendable(appliance, min_watts_for_shutdown)
                ]
                else "feasibility-aware-target"
            )
        ),
    }


def handle_recommendation_request() -> Any:
    uid, user_id, profile_id = resolve_request_context()

    try:
        return jsonify(build_recommendation_plan(uid, user_id, profile_id)), 200
    except requests.RequestException as error:
        return (
            jsonify(
                {
                    "error": "Downstream microservice is unreachable",
                    "details": str(error),
                }
            ),
            503,
        )
    except RuntimeError as error:
        return jsonify({"error": str(error)}), 502
    except Exception as error:
        return jsonify({"error": "Failed to generate recommendation", "details": str(error)}), 500


@app.route("/api/forecast", methods=["GET", "POST"])
def get_forecast() -> Any:
    return handle_forecast_request()


@app.route("/api/forecast/recommendation", methods=["GET", "POST"])
def get_forecast_recommendation() -> Any:
    return handle_recommendation_request()


@app.route("/api/forecastbill", methods=["POST"])
def post_forecastbill() -> Any:
    return handle_forecast_request()


if __name__ == "__main__":
    print("ForecastBill service is ready on port 5009", flush=True)
    app.run(host="0.0.0.0", port=5009, debug=False)
