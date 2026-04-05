import json
import os
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import urljoin

import pika
import requests
from flask import Flask, jsonify, request
from flask_cors import CORS


PORT = int(os.getenv("PORT", "5012"))
FORECASTBILL_SERVICE_URL = os.getenv(
    "FORECASTBILL_SERVICE_URL", "http://forecastbill_service:5009"
)
BUDGET_SERVICE_URL = os.getenv("BUDGET_SERVICE_URL", "http://budget_service:5004")
REQUEST_TIMEOUT_SECONDS = float(os.getenv("REQUEST_TIMEOUT_SECONDS", "8"))
DEFAULT_UID = os.getenv("DEFAULT_UID", "user_demo_001")
DEFAULT_BUDGET_USER_ID = int(os.getenv("DEFAULT_BUDGET_USER_ID", "1"))
HISTORY_EVENTS_QUEUE = os.getenv("HISTORY_EVENTS_QUEUE", "history.events.v1")

SERVICE_FALLBACK_URLS = {
    "forecastbill": [
        FORECASTBILL_SERVICE_URL,
        "http://host.docker.internal:5009",
        "http://127.0.0.1:5009",
        "http://localhost:5009",
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


def parse_positive_int(value: Any) -> Optional[int]:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None

    if parsed <= 0:
        return None

    return parsed


def parse_positive_float(value: Any) -> Optional[float]:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None

    if parsed <= 0:
        return None

    return parsed


def parse_non_negative_float(value: Any) -> Optional[float]:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None

    if parsed < 0:
        return None

    return parsed


def iso_utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def get_rabbitmq_url_candidates() -> list[str]:
    configured_list = [
        value.strip()
        for value in os.getenv("RABBITMQ_URLS", "").split(",")
        if value.strip()
    ]
    if configured_list:
        return configured_list

    configured_single = os.getenv("RABBITMQ_URL", "").strip()
    if configured_single:
        return [configured_single]

    return [
        "amqp://guest:guest@localhost:5672",
        "amqp://guest:guest@127.0.0.1:5672",
        "amqp://guest:guest@rabbitmq:5672",
    ]


def connect_rabbitmq() -> pika.BlockingConnection:
    urls = get_rabbitmq_url_candidates()
    last_error: Exception | None = None

    for url in urls:
        try:
            connection = pika.BlockingConnection(pika.URLParameters(url))
            print(f"UpdateBudget connected to RabbitMQ at {url}", flush=True)
            return connection
        except Exception as error:
            last_error = error

    raise RuntimeError(
        f"Unable to connect to RabbitMQ using configured URLs ({', '.join(urls)}). Last error: {last_error}"
    )


def is_untrusted_host_400(response: requests.Response) -> bool:
    if response.status_code != 400:
        return False

    body = response.text or ""
    return "is not trusted" in body and "Host" in body


def request_with_fallback(
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


def resolve_budget_cap(body: dict[str, Any]) -> float:
    raw_budget_cap = body.get("budget_cap", body.get("monthlyCap"))
    parsed = parse_positive_float(raw_budget_cap)
    if parsed is None:
        raise ValueError("budget_cap (or monthlyCap) must be a positive number")
    return round(parsed, 2)


def ensure_budget_exists(user_id: int) -> None:
    get_response = request_with_fallback("budget", "GET", f"/api/budget/{user_id}")
    get_payload = parse_response_json(get_response)

    if get_response.status_code == 200:
        return

    if get_response.status_code != 404:
        raise RuntimeError(
            extract_error_message(
                get_payload,
                f"budget-service returned HTTP {get_response.status_code}",
            )
        )

    create_response = request_with_fallback(
        "budget",
        "POST",
        "/api/budget",
        json_body={"user_id": user_id},
    )
    create_payload = parse_response_json(create_response)

    if create_response.status_code not in {200, 201}:
        raise RuntimeError(
            extract_error_message(
                create_payload,
                f"budget-service create failed with HTTP {create_response.status_code}",
            )
        )


def run_forecast(user_id: int, uid: str, profile_id: str) -> tuple[dict[str, Any], float]:
    response = request_with_fallback(
        "forecastbill",
        "POST",
        "/api/forecast",
        json_body={
            "uid": uid,
            "user_id": user_id,
            "profile_id": profile_id,
        },
    )
    payload = parse_response_json(response)

    if response.status_code != 200:
        raise RuntimeError(
            extract_error_message(
                payload,
                f"forecastbill-service returned HTTP {response.status_code}",
            )
        )

    if not isinstance(payload, dict):
        raise RuntimeError("forecastbill-service returned an invalid payload")

    projected_cost = parse_non_negative_float(payload.get("projectedCost"))
    if projected_cost is None:
        raise RuntimeError("forecastbill-service payload is missing projectedCost")

    return payload, round(projected_cost, 2)


def update_budget_cap(user_id: int, budget_cap: float) -> dict[str, Any]:
    ensure_budget_exists(user_id)

    response = request_with_fallback(
        "budget",
        "PATCH",
        f"/api/budget/{user_id}/cap",
        json_body={"budget_cap": budget_cap},
    )
    payload = parse_response_json(response)

    if response.status_code != 200 or (isinstance(payload, dict) and payload.get("success") is False):
        raise RuntimeError(
            extract_error_message(
                payload,
                f"budget-service cap update failed with HTTP {response.status_code}",
            )
        )

    if isinstance(payload, dict) and isinstance(payload.get("data"), dict):
        return payload["data"]

    return {
        "user_id": user_id,
        "budget_cap": budget_cap,
    }


def publish_budget_update_event(
    uid: str,
    accepted: bool,
    requested_budget_cap: float,
    projected_monthly_spend: float,
) -> Optional[dict[str, Any]]:
    event_name = "BudgetUpdateAccepted" if accepted else "BudgetUpdateRejected"
    occurred_at = iso_utc_now()
    body = json.dumps(
        {
            "user_id": uid,
            "message": (
                f"{event_name}: requested budget_cap ${requested_budget_cap:.2f}; "
                f"projected spend ${projected_monthly_spend:.2f}."
            ),
            "occurred_at": occurred_at,
        }
    ).encode("utf-8")

    connection = connect_rabbitmq()
    try:
        channel = connection.channel()
        channel.queue_declare(queue=HISTORY_EVENTS_QUEUE, durable=True)
        channel.basic_publish(
            exchange="",
            routing_key=HISTORY_EVENTS_QUEUE,
            body=body,
            properties=pika.BasicProperties(
                delivery_mode=2,
                content_type="application/json",
            ),
        )
    finally:
        if connection.is_open:
            connection.close()

    return {
        "published": True,
        "event": event_name,
        "queue": HISTORY_EVENTS_QUEUE,
        "occurred_at": occurred_at,
    }


def process_update_budget(user_id: int, body: dict[str, Any]) -> tuple[dict[str, Any], int]:
    requested_budget_cap = resolve_budget_cap(body)

    uid = str(body.get("uid") or user_id or DEFAULT_UID).strip()
    if not uid:
        uid = DEFAULT_UID

    profile_id = str(body.get("profile_id") or body.get("profileId") or user_id).strip()
    if not profile_id:
        profile_id = str(user_id)

    forecast, projected_monthly_spend = run_forecast(user_id, uid, profile_id)

    accepted = requested_budget_cap >= projected_monthly_spend
    action = "budget_update_accepted" if accepted else "budget_update_rejected"

    budget_data = None
    if accepted:
        budget_data = update_budget_cap(user_id, requested_budget_cap)

    history_ack = publish_budget_update_event(
        uid=uid,
        accepted=accepted,
        requested_budget_cap=requested_budget_cap,
        projected_monthly_spend=projected_monthly_spend,
    )

    message = (
        f"Budget update accepted. New budget cap ${requested_budget_cap:.2f} covers projected spend ${projected_monthly_spend:.2f}."
        if accepted
        else f"Budget update rejected. Requested cap ${requested_budget_cap:.2f} is below projected spend ${projected_monthly_spend:.2f}."
    )

    payload: dict[str, Any] = {
        "success": True,
        "accepted": accepted,
        "action": action,
        "uid": uid,
        "user_id": user_id,
        "requestedMonthlyCap": requested_budget_cap,
        "projectedMonthlySpend": projected_monthly_spend,
        "message": message,
        "forecast": forecast,
        "history": history_ack,
    }

    if budget_data is not None:
        payload["budget"] = budget_data

    return payload, 200


@app.route("/", methods=["GET"])
def home() -> Any:
    return jsonify(
        {
            "status": "online",
            "service": "UpdateBudget Composite Service",
            "endpoints": ["PUT /api/updatebudget/<user_id>", "POST /api/updatebudget"],
        }
    )


@app.route("/api/updatebudget/<int:user_id>", methods=["PUT"])
def update_budget_for_user(user_id: int) -> Any:
    body = request.get_json(silent=True) or {}

    try:
        result, status = process_update_budget(user_id, body)
        return jsonify(result), status
    except ValueError as error:
        return jsonify({"success": False, "error": str(error)}), 400
    except requests.RequestException as error:
        return (
            jsonify(
                {
                    "success": False,
                    "error": "Downstream service is unreachable",
                    "details": str(error),
                }
            ),
            503,
        )
    except RuntimeError as error:
        return jsonify({"success": False, "error": str(error)}), 502
    except Exception as error:
        return (
            jsonify(
                {
                    "success": False,
                    "error": "Failed to process updatebudget request",
                    "details": str(error),
                }
            ),
            500,
        )


@app.route("/api/updatebudget", methods=["POST"])
def update_budget_from_body() -> Any:
    body = request.get_json(silent=True) or {}

    user_id = (
        parse_positive_int(body.get("user_id"))
        or parse_positive_int(body.get("uid"))
        or DEFAULT_BUDGET_USER_ID
    )

    if user_id <= 0:
        return jsonify({"success": False, "error": "user_id must be a positive integer"}), 400

    try:
        result, status = process_update_budget(user_id, body)
        return jsonify(result), status
    except ValueError as error:
        return jsonify({"success": False, "error": str(error)}), 400
    except requests.RequestException as error:
        return (
            jsonify(
                {
                    "success": False,
                    "error": "Downstream service is unreachable",
                    "details": str(error),
                }
            ),
            503,
        )
    except RuntimeError as error:
        return jsonify({"success": False, "error": str(error)}), 502
    except Exception as error:
        return (
            jsonify(
                {
                    "success": False,
                    "error": "Failed to process updatebudget request",
                    "details": str(error),
                }
            ),
            500,
        )


if __name__ == "__main__":
    print(f"UpdateBudget composite service ready on port {PORT}", flush=True)
    app.run(host="0.0.0.0", port=PORT, debug=False)
