import os
from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Any, Optional
from urllib.parse import urljoin

import requests
from flask import Flask, jsonify, request
from flask_cors import CORS


def get_cors_origins() -> list[str]:
    configured = [
        origin.strip()
        for origin in os.getenv("CORS_ORIGINS", "").split(",")
        if origin.strip()
    ]
    if configured:
        return configured
    return ["http://localhost:3000", "http://127.0.0.1:3000"]


def is_debug_enabled() -> bool:
    return os.getenv("FLASK_DEBUG", "false").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def parse_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return default


def to_positive_int(value: Any, fallback: int) -> int:
    try:
        parsed = int(value)
        if parsed > 0:
            return parsed
    except (TypeError, ValueError):
        pass
    return fallback


def to_positive_float(value: Any, fallback: float) -> float:
    try:
        parsed = float(value)
        if parsed > 0:
            return parsed
    except (TypeError, ValueError):
        pass
    return fallback


APPLIANCE_SERVICE_URL = os.getenv("APPLIANCE_SERVICE_URL", "http://appliance_service:5002")
RATE_SERVICE_URL = os.getenv("RATE_SERVICE_URL", "http://rate_service:5007")
BILL_SERVICE_URL = os.getenv("BILL_SERVICE_URL", "http://bill_service:5003")
BUDGET_SERVICE_URL = os.getenv("BUDGET_SERVICE_URL", "http://budget_service:5004")
REQUEST_TIMEOUT_SECONDS = to_positive_float(os.getenv("REQUEST_TIMEOUT_SECONDS"), 8.0)
DEFAULT_BILL_USER_ID = to_positive_int(os.getenv("DEFAULT_BILL_USER_ID"), 1)
DEFAULT_APPLIANCE_UID = os.getenv("DEFAULT_APPLIANCE_UID", "user_demo_001")
DEFAULT_INTERVAL_MINUTES = to_positive_float(os.getenv("BILL_INTERVAL_MINUTES"), 15.0)
SYNC_BUDGET_EACH_RUN = parse_bool(os.getenv("SYNC_BUDGET_EACH_RUN"), True)
AUTO_CLOSE_AT_MONTH_END = parse_bool(os.getenv("AUTO_CLOSE_AT_MONTH_END"), False)

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": get_cors_origins()}})

STATE_LOCK = Lock()
CYCLE_STATE: dict[int, dict[str, Any]] = {}

SERVICE_FALLBACK_URLS = {
    "appliance": [
        APPLIANCE_SERVICE_URL,
        "http://host.docker.internal:5002",
        "http://127.0.0.1:5002",
        "http://localhost:5002",
    ],
    "rate": [
        RATE_SERVICE_URL,
        "http://host.docker.internal:5007",
        "http://127.0.0.1:5007",
        "http://localhost:5007",
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


def parse_response_json(response: requests.Response) -> Any:
    try:
        return response.json()
    except ValueError:
        return None


def extract_error_message(payload: Any, fallback: str) -> str:
    if isinstance(payload, dict):
        candidate = payload.get("error") or payload.get("message")
        if isinstance(candidate, str) and candidate.strip():
            return candidate
    return fallback


def normalize_base_url(base_url: str) -> str:
    return base_url.strip().rstrip("/")


def is_untrusted_host_400(response: requests.Response) -> bool:
    if response.status_code != 400:
        return False
    body = response.text or ""
    return "is not trusted" in body and "Host" in body


def request_with_service_fallback(
    service: str,
    method: str,
    path: str,
    *,
    params: Optional[dict[str, Any]] = None,
    json_body: Optional[dict[str, Any]] = None,
) -> requests.Response:
    candidates = [normalize_base_url(url) for url in SERVICE_FALLBACK_URLS[service] if url]
    seen: set[str] = set()
    unique_candidates = []
    for candidate in candidates:
        if candidate in seen:
            continue
        seen.add(candidate)
        unique_candidates.append(candidate)

    last_error: Optional[Exception] = None
    for base_url in unique_candidates:
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
    raise RuntimeError(f"Unable to reach {service}-service across all configured base URLs")


def fetch_appliances(uid: str) -> list[dict[str, Any]]:
    response = request_with_service_fallback(
        "appliance",
        "GET",
        "/api/appliance",
        params={"uid": uid},
    )
    payload = parse_response_json(response)
    if response.status_code != 200 or not isinstance(payload, list):
        raise RuntimeError(
            extract_error_message(
                payload,
                f"appliance-service returned HTTP {response.status_code}",
            )
        )
    return payload


def fetch_current_rate_cents() -> float:
    response = request_with_service_fallback("rate", "GET", "/api/rate")
    payload = parse_response_json(response)
    if response.status_code != 200 or not isinstance(payload, dict):
        raise RuntimeError(
            extract_error_message(payload, f"rate-service returned HTTP {response.status_code}")
        )

    data = payload.get("data")
    if not isinstance(data, list) or len(data) == 0 or not isinstance(data[0], dict):
        raise RuntimeError("rate-service response does not contain an active rate")

    cents = data[0].get("cents_per_kwh")
    try:
        return float(cents)
    except (TypeError, ValueError):
        raise RuntimeError("rate-service returned a non-numeric cents_per_kwh")


def create_bill_record(
    user_id: int,
    period_cost_sgd: float,
    period_kwh: float,
    computed_at: datetime,
    billing_period_start_iso: str,
) -> dict[str, Any]:
    payload = {
        "user_id": user_id,
        "period_cost_sgd": period_cost_sgd,
        "period_kwh": period_kwh,
        "computed_at": computed_at.isoformat(),
        "billing_period_start": billing_period_start_iso,
    }
    response = request_with_service_fallback(
        "bill",
        "POST",
        "/api/bills",
        json_body=payload,
    )
    response_payload = parse_response_json(response)
    if response.status_code not in {200, 201}:
        raise RuntimeError(
            extract_error_message(
                response_payload,
                f"bill-service returned HTTP {response.status_code}",
            )
        )

    if isinstance(response_payload, dict):
        bill_data = response_payload.get("data")
        if isinstance(bill_data, dict):
            return bill_data
    return payload


def get_or_create_budget(user_id: int) -> dict[str, Any]:
    response = request_with_service_fallback("budget", "GET", f"/api/budget/{user_id}")
    payload = parse_response_json(response)

    if response.status_code == 200 and isinstance(payload, dict):
        data = payload.get("data")
        if isinstance(data, dict):
            return data

    if response.status_code == 404:
        create_response = request_with_service_fallback(
            "budget",
            "POST",
            "/api/budget",
            json_body={"user_id": user_id},
        )
        create_payload = parse_response_json(create_response)
        if create_response.status_code in {200, 201} and isinstance(create_payload, dict):
            data = create_payload.get("data")
            if isinstance(data, dict):
                return data

        raise RuntimeError(
            extract_error_message(
                create_payload,
                f"budget-service create failed with HTTP {create_response.status_code}",
            )
        )

    raise RuntimeError(
        extract_error_message(payload, f"budget-service returned HTTP {response.status_code}")
    )


def update_budget_cum_bill(user_id: int, cum_bill: float) -> dict[str, Any]:
    budget = get_or_create_budget(user_id)
    budget_id = budget.get("budget_id")
    if not isinstance(budget_id, int):
        raise RuntimeError("budget-service payload is missing budget_id")

    response = request_with_service_fallback(
        "budget",
        "PUT",
        f"/api/budget/{budget_id}",
        json_body={"cum_bill": cum_bill},
    )
    payload = parse_response_json(response)
    if response.status_code != 200:
        raise RuntimeError(
            extract_error_message(
                payload,
                f"budget-service update failed with HTTP {response.status_code}",
            )
        )

    if isinstance(payload, dict):
        data = payload.get("data")
        if isinstance(data, dict):
            return data
    return budget


def calculate_period_kwh(appliances: list[dict[str, Any]], interval_minutes: float) -> tuple[float, int, int]:
    active_count = 0
    total_watts = 0
    for appliance in appliances:
        if not isinstance(appliance, dict):
            continue
        state = str(appliance.get("state", "")).upper()
        if state != "ON":
            continue

        watts_value = appliance.get("currentWatts", appliance.get("current_watts", 0))
        try:
            watts = int(float(watts_value))
        except (TypeError, ValueError):
            watts = 0

        if watts <= 0:
            continue

        active_count += 1
        total_watts += watts

    period_kwh = (total_watts * (interval_minutes / 60.0)) / 1000.0
    return round(period_kwh, 6), total_watts, active_count


def get_month_key(now_utc: datetime) -> str:
    return now_utc.strftime("%Y-%m")


def is_last_day_of_month(now_utc: datetime) -> bool:
    return (now_utc.date() + timedelta(days=1)).month != now_utc.month


def update_running_total(user_id: int, month_key: str, period_cost_sgd: float) -> float:
    with STATE_LOCK:
        current = CYCLE_STATE.get(user_id)
        if not current or current.get("month") != month_key:
            running_total = 0.0
            closed_month = None
        else:
            running_total = float(current.get("running_total", 0.0))
            closed_month = current.get("closed_month")

        running_total = round(running_total + period_cost_sgd, 4)
        CYCLE_STATE[user_id] = {
            "month": month_key,
            "running_total": running_total,
            "closed_month": closed_month,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        return running_total


def close_month_if_needed(user_id: int, month_key: str, monthly_total: float) -> dict[str, Any]:
    with STATE_LOCK:
        current = CYCLE_STATE.get(user_id)
        if not current or current.get("month") != month_key:
            return {
                "closed": False,
                "reason": "No active cycle state for month.",
            }

        if current.get("closed_month") == month_key:
            return {
                "closed": False,
                "reason": "Month already closed.",
            }

        current["closed_month"] = month_key
        current["running_total"] = 0.0
        current["updated_at"] = datetime.now(timezone.utc).isoformat()

    return {
        "closed": True,
        "finalized_month": month_key,
        "finalized_total": round(monthly_total, 4),
        "next_cycle_running_total": 0.0,
    }


@app.route("/", methods=["GET"])
def home():
    return jsonify(
        {
            "status": "online",
            "service": "CalculateBill Composite Microservice",
            "endpoints": [
                "GET /api/calculatebill/state",
                "POST /api/calculatebill/run",
            ],
        }
    ), 200


@app.route("/api/calculatebill/state", methods=["GET"])
def cycle_state():
    with STATE_LOCK:
        return jsonify(
            {
                "success": True,
                "data": {
                    str(user_id): state
                    for user_id, state in CYCLE_STATE.items()
                },
            }
        ), 200


@app.route("/api/calculatebill/run", methods=["POST"])
def run_calculation_cycle():
    body = request.get_json(silent=True) or {}

    user_id = to_positive_int(body.get("user_id"), DEFAULT_BILL_USER_ID)
    uid = str(body.get("uid") or DEFAULT_APPLIANCE_UID)
    interval_minutes = to_positive_float(
        body.get("interval_minutes"),
        DEFAULT_INTERVAL_MINUTES,
    )
    sync_budget = parse_bool(body.get("sync_budget"), SYNC_BUDGET_EACH_RUN)
    force_month_close = parse_bool(body.get("force_month_close"), False)

    now_utc = datetime.now(timezone.utc)
    month_key = get_month_key(now_utc)
    billing_period_start_iso = now_utc.date().replace(day=1).isoformat()

    try:
        appliances = fetch_appliances(uid)
        period_kwh, total_watts, active_count = calculate_period_kwh(
            appliances,
            interval_minutes,
        )

        cents_per_kwh = fetch_current_rate_cents()
        period_cost_sgd = round(period_kwh * (cents_per_kwh / 100.0), 4)

        bill = create_bill_record(
            user_id=user_id,
            period_cost_sgd=period_cost_sgd,
            period_kwh=period_kwh,
            computed_at=now_utc,
            billing_period_start_iso=billing_period_start_iso,
        )

        monthly_total = update_running_total(user_id, month_key, period_cost_sgd)

        budget_update = None
        if sync_budget:
            budget_update = update_budget_cum_bill(user_id, monthly_total)

        month_close_result = {
            "closed": False,
            "reason": "Month close not requested.",
        }
        should_auto_close = AUTO_CLOSE_AT_MONTH_END and is_last_day_of_month(now_utc)
        if force_month_close or should_auto_close:
            if not sync_budget:
                budget_update = update_budget_cum_bill(user_id, monthly_total)
            month_close_result = close_month_if_needed(user_id, month_key, monthly_total)

        return jsonify(
            {
                "success": True,
                "data": {
                    "user_id": user_id,
                    "uid": uid,
                    "interval_minutes": interval_minutes,
                    "computed_at": now_utc.isoformat(),
                    "billing_period_start": billing_period_start_iso,
                    "inputs": {
                        "active_appliances": active_count,
                        "total_watts": total_watts,
                        "cents_per_kwh": round(cents_per_kwh, 4),
                    },
                    "result": {
                        "period_kwh": period_kwh,
                        "period_cost_sgd": period_cost_sgd,
                        "monthly_total_sgd": monthly_total,
                    },
                    "bill": bill,
                    "budget": budget_update,
                    "month_close": month_close_result,
                },
            }
        ), 200
    except requests.RequestException as error:
        return jsonify(
            {
                "success": False,
                "error": "Downstream microservice is unreachable",
                "details": str(error),
            }
        ), 503
    except Exception as error:
        return jsonify(
            {
                "success": False,
                "error": str(error),
            }
        ), 500


if __name__ == "__main__":
    print("CalculateBill composite service is ready on port 5008", flush=True)
    app.run(host="0.0.0.0", port=5008, debug=is_debug_enabled())
