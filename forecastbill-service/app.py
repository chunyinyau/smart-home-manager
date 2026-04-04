import calendar
import os
import sys
from datetime import datetime, timezone
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
RATE_SERVICE_URL = os.getenv("RATE_SERVICE_URL", "http://rate_service:5007")
REQUEST_TIMEOUT_SECONDS = float(os.getenv("REQUEST_TIMEOUT_SECONDS", "8"))
DEFAULT_BILL_USER_ID = int(os.getenv("DEFAULT_BILL_USER_ID", "1"))
DEFAULT_FORECAST_UID = os.getenv("DEFAULT_FORECAST_UID", "user_demo_001")

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
    "rate": [
        RATE_SERVICE_URL,
        "http://host.docker.internal:5007",
        "http://127.0.0.1:5007",
        "http://localhost:5007",
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


def fetch_rate_snapshot() -> tuple[float, float, str]:
    response = request_with_service_fallback("rate", "GET", "/api/rate")
    payload = get_response_json(response)

    if response.status_code != 200:
        raise RuntimeError(
            extract_error_message(payload, f"rate-service returned HTTP {response.status_code}")
        )

    if not isinstance(payload, dict) or not isinstance(payload.get("data"), list) or not payload["data"]:
        raise RuntimeError("rate-service returned no active rate")

    first = payload["data"][0]
    if not isinstance(first, dict):
        raise RuntimeError("rate-service payload format is invalid")

    cents_per_kwh = parse_float(first.get("cents_per_kwh"))
    month_year = first.get("month_year")

    if cents_per_kwh is None or cents_per_kwh <= 0:
        raise RuntimeError("rate-service returned invalid cents_per_kwh")

    if not isinstance(month_year, str) or not month_year.strip():
        raise RuntimeError("rate-service returned invalid month_year")

    return round(cents_per_kwh, 4), round(cents_per_kwh / 100.0, 6), month_year


def fetch_same_month_spend_history(user_id: int, target_month: str) -> list[dict[str, Any]]:
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

        computed_at = record.get("computed_at")
        billing_period_start = record.get("billing_period_start")
        if iso_to_month_key(str(computed_at)) != target_month and iso_to_month_key(str(billing_period_start)) != target_month:
            continue

        bill_id = parse_positive_int(record.get("bill_id"))
        period_cost_sgd = parse_float(record.get("period_cost_sgd"))
        period_kwh = parse_float(record.get("period_kwh"))

        if bill_id is None or period_cost_sgd is None or period_kwh is None:
            continue

        normalized.append(
            {
                "billId": bill_id,
                "periodCostSgd": round(period_cost_sgd, 4),
                "periodKwh": round(period_kwh, 4),
                "computedAt": str(computed_at),
                "billingPeriodStart": str(billing_period_start),
            }
        )

    normalized.sort(key=lambda row: row.get("computedAt", ""))
    return normalized


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


def normalize_ai_assessment(payload: Any) -> Optional[dict[str, Any]]:
    if not isinstance(payload, dict):
        return None

    risk_level = payload.get("risk_level")
    days_to_exceed = payload.get("days_to_exceed")
    short_narrative = payload.get("short_narrative")

    if not isinstance(risk_level, str) or risk_level.upper() not in {"SAFE", "HIGH", "CRITICAL"}:
        return None

    normalized_days: Optional[int]
    if days_to_exceed is None:
        normalized_days = None
    else:
        parsed_days = parse_positive_int(days_to_exceed)
        normalized_days = parsed_days if parsed_days is not None else 0

    if not isinstance(short_narrative, str) or len(short_narrative.strip()) < 8:
        return None

    return {
        "riskLevel": risk_level.upper(),
        "daysToExceed": normalized_days,
        "shortNarrative": short_narrative.strip(),
    }


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
        key_status = (
            f"{api_key_source}=...{api_key[-4:]}"
            if isinstance(api_key, str) and len(api_key) >= 4 and api_key_source
            else (api_key_source or "present")
        )
        print(f"ForecastBill PicoClaw request starting; api_key={key_status}", flush=True)
        result = run_forecast_check(ai_input)
        assessment = normalize_ai_assessment(result.get("assessment") if isinstance(result, dict) else None)
        if assessment is None:
            print("ForecastBill PicoClaw returned an invalid assessment; using fallback", flush=True)
            return fallback
        print("ForecastBill PicoClaw request completed successfully", flush=True)
        return assessment
    except Exception as error:
        print(f"ForecastBill PicoClaw fallback activated: {error}", flush=True)
        return fallback


def build_forecast(uid: str, user_id: int) -> dict[str, Any]:
    now_utc = datetime.now(timezone.utc)
    current_month = month_key(now_utc)

    same_month_spend_history = fetch_same_month_spend_history(user_id, current_month)
    budget_cap, last_month_cumulative_bill = fetch_budget_snapshot(user_id)
    cents_per_kwh, price_per_kwh, tariff_month_year = fetch_rate_snapshot()

    same_month_spend_total = round(
        sum(float(entry["periodCostSgd"]) for entry in same_month_spend_history),
        2,
    )

    days_in_month = calendar.monthrange(now_utc.year, now_utc.month)[1]
    elapsed_days = max(1, min(now_utc.day, days_in_month))
    days_remaining = max(days_in_month - elapsed_days, 0)

    same_month_average_daily_spend = round(same_month_spend_total / elapsed_days, 4)
    last_month_average_daily_spend = round(last_month_cumulative_bill / max(days_in_month, 1), 4)
    projection_daily_spend = (
        same_month_average_daily_spend
        if same_month_average_daily_spend > 0
        else last_month_average_daily_spend
    )

    projected_month_end_spend = round(
        same_month_spend_total + projection_daily_spend * days_remaining,
        2,
    )

    suggested_days_to_exceed = calculate_days_to_exceed(
        budget_cap,
        same_month_spend_total,
        projection_daily_spend,
    )

    fallback_risk_level = derive_risk_level(projected_month_end_spend, budget_cap)
    fallback_assessment = {
        "riskLevel": fallback_risk_level,
        "daysToExceed": suggested_days_to_exceed,
        "shortNarrative": fallback_short_narrative(
            fallback_risk_level,
            projected_month_end_spend,
            budget_cap,
        ),
    }

    ai_input = {
        "month": current_month,
        "budgetCap": budget_cap,
        "sameMonthSpendTotal": same_month_spend_total,
        "sameMonthSpendHistoryCount": len(same_month_spend_history),
        "lastMonthCumulativeBill": last_month_cumulative_bill,
        "averageDailySpend": projection_daily_spend,
        "projectedMonthEndSpend": projected_month_end_spend,
        "daysRemaining": days_remaining,
        "suggestedDaysToExceed": suggested_days_to_exceed,
        "tariffCentsPerKwh": cents_per_kwh,
        "tariffMonthYear": tariff_month_year,
    }

    assessment = get_ai_assessment(ai_input, fallback_assessment)
    projected_kwh = round(projected_month_end_spend / price_per_kwh, 1) if price_per_kwh > 0 else 0.0

    return {
        "uid": uid,
        "userId": user_id,
        "month": current_month,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "projectedKwh": projected_kwh,
        "projectedCost": projected_month_end_spend,
        "reasoning": assessment["shortNarrative"],
        "riskLevel": assessment["riskLevel"],
        "daysToExceed": assessment["daysToExceed"],
        "shortNarrative": assessment["shortNarrative"],
        "billing": {
            "sameMonthSpendHistory": same_month_spend_history,
            "sameMonthSpendTotal": same_month_spend_total,
            "sameMonthAverageDailySpend": round(same_month_average_daily_spend, 2),
        },
        "budget": {
            "budgetCap": budget_cap,
            "lastMonthCumulativeBill": last_month_cumulative_bill,
        },
        "rate": {
            "monthYear": tariff_month_year,
            "centsPerKwh": cents_per_kwh,
            "pricePerKwh": round(price_per_kwh, 6),
        },
    }


@app.route("/", methods=["GET"])
def home() -> Any:
    return jsonify(
        {
            "status": "online",
            "service": "ForecastBill Composite Microservice",
            "endpoints": ["GET /api/forecast"],
        }
    )


@app.route("/api/forecast", methods=["GET"])
def get_forecast() -> Any:
    uid = (
        request.args.get("uid")
        or request.args.get("user_id")
        or DEFAULT_FORECAST_UID
    )

    user_id_raw = request.args.get("user_id")
    user_id = (
        parse_positive_int(user_id_raw)
        or parse_positive_int(uid)
        or DEFAULT_BILL_USER_ID
    )

    try:
        return jsonify(build_forecast(str(uid), user_id)), 200
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


if __name__ == "__main__":
    print("ForecastBill service is ready on port 5009", flush=True)
    app.run(host="0.0.0.0", port=5009, debug=False)
