import calendar
import os
import sys
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urljoin

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


BILL_SERVICE_URL = os.getenv("BILL_SERVICE_URL", "http://bill_service:5003")
BUDGET_SERVICE_URL = os.getenv("BUDGET_SERVICE_URL", "http://budget_service:5004")
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

SERVICE_FALLBACK_URLS = {
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


def fallback_recommendations(risk_level: str, hdb_type: str) -> list[str]:
    suffix = f"for HDB type {hdb_type}" if hdb_type else "for your household"
    if risk_level == "CRITICAL":
        return [
            f"Air conditioner: switch off when room is unoccupied ({suffix}).",
            "Water heater: keep sessions below 10 minutes and power off after use.",
            "Clothes dryer: replace with air-drying where possible.",
            "Desktop/Gaming PC: shut down fully overnight.",
            "TV and set-top box: turn off at the socket to remove standby draw.",
        ]

    if risk_level == "HIGH":
        return [
            "Air conditioner: increase setpoint by 1-2C and turn off early.",
            "Water heater: avoid reheating between back-to-back showers.",
            "Laundry and cooking: avoid simultaneous high-load appliances.",
        ]

    return [
        "Maintain current usage pattern; switch off air conditioner when leaving rooms.",
        "Turn off entertainment devices fully at night to keep standby consumption low.",
    ]


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

    if budget_cap is None or budget_cap <= 0:
        raise RuntimeError("budget-service budget_cap is invalid")

    if last_month_cumulative_bill is None:
        raise RuntimeError("budget-service cum_bill is invalid")

    return round(budget_cap, 2), round(last_month_cumulative_bill, 2)


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


def resolve_picoclaw_api_key() -> tuple[Optional[str], Optional[str]]:
    api_key = os.getenv("PICOCLAW_API_KEY")
    if api_key:
        return api_key, "PICOCLAW_API_KEY"

    return None, None


def get_ai_assessment(
    ai_input: dict[str, Any],
    fallback: dict[str, Any],
) -> dict[str, Any]:
    if run_forecast_check is None:
        print("ForecastBill PicoClaw disabled: helper unavailable", flush=True)
        return fallback

    try:
        api_key, api_key_source = resolve_picoclaw_api_key()
        if api_key and api_key_source:
            print(f"ForecastBill PicoClaw request starting; key={api_key_source}", flush=True)
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

    suggested_days_to_exceed = calculate_days_to_exceed(
        budget_cap,
        current_period_total_cost,
        current_average_daily_spend,
    )

    fallback_risk_level = derive_risk_level(projected_month_end_spend, budget_cap)
    fallback_recommended = fallback_recommendations(fallback_risk_level, str(profile["hdbType"]))
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

    projected_cost = round(float(assessment["projectedCost"]), 2)
    projected_kwh = round(float(assessment["projectedKwh"]), 2)
    effective_price_per_kwh = round(
        projected_cost / projected_kwh,
        6,
    ) if projected_kwh > 0 else 0.0

    return {
        "uid": uid,
        "userId": user_id,
        "month": current_month,
        "billingPeriodStart": current_period_start.isoformat(),
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "projectedKwh": projected_kwh,
        "projectedCost": projected_cost,
        "reasoning": assessment["shortNarrative"],
        "riskLevel": assessment["riskLevel"],
        "daysToExceed": assessment["daysToExceed"],
        "shortNarrative": assessment["shortNarrative"],
        "recommendedAppliances": assessment["recommendedAppliances"],
        "recommendations": assessment["recommendedAppliances"],
        "model": assessment.get("model"),
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
            "endpoints": ["GET /api/forecast", "POST /api/forecast", "POST /api/forecastbill"],
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


@app.route("/api/forecast", methods=["GET", "POST"])
def get_forecast() -> Any:
    return handle_forecast_request()


@app.route("/api/forecastbill", methods=["POST"])
def post_forecastbill() -> Any:
    return handle_forecast_request()


if __name__ == "__main__":
    print("ForecastBill service is ready on port 5009", flush=True)
    app.run(host="0.0.0.0", port=5009, debug=False)
