import os
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import urljoin

import requests
from flask import Flask, jsonify, request
from flask_cors import CORS


PORT = int(os.getenv("PORT", "5011"))
CHANGE_STATE_SERVICE_URL = os.getenv(
    "CHANGE_STATE_SERVICE_URL",
    "http://change_state_service:5010",
)
HISTORY_SERVICE_URL = os.getenv("HISTORY_SERVICE_URL", "http://history_service:5005")
REQUEST_TIMEOUT_SECONDS = float(os.getenv("REQUEST_TIMEOUT_SECONDS", "8"))
DEFAULT_UID = os.getenv("DEFAULT_UID", "user_demo_001")

SERVICE_FALLBACK_URLS = {
    "automator": [
        CHANGE_STATE_SERVICE_URL,
        "http://host.docker.internal:5010",
        "http://127.0.0.1:5010",
        "http://localhost:5010",
    ],
    "history": [
        HISTORY_SERVICE_URL,
        "http://host.docker.internal:5005",
        "http://127.0.0.1:5005",
        "http://localhost:5005",
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
            return response
        except requests.RequestException as error:
            last_error = error

    if last_error:
        raise last_error
    raise RuntimeError(f"Unable to reach {service}-service across all configured base URLs")


def to_iso_utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def pick_forecast_summary(automator_payload: dict[str, Any]) -> Optional[dict[str, Any]]:
    if not isinstance(automator_payload, dict):
        return None

    forecast = automator_payload.get("forecast")
    if isinstance(forecast, dict):
        return {
            "riskLevel": forecast.get("riskLevel"),
            "projectedCost": forecast.get("projectedCost"),
            "shortNarrative": forecast.get("shortNarrative"),
        }

    data = automator_payload.get("data")
    if isinstance(data, dict) and isinstance(data.get("forecast"), dict):
        nested = data["forecast"]
        return {
            "riskLevel": nested.get("riskLevel"),
            "projectedCost": nested.get("projectedCost"),
            "shortNarrative": nested.get("shortNarrative"),
        }

    return None


def pick_changed_appliances(automator_payload: dict[str, Any]) -> list[dict[str, Any]]:
    if not isinstance(automator_payload, dict):
        return []

    for key in ["changed_appliances", "affected_appliances", "appliances"]:
        candidate = automator_payload.get(key)
        if isinstance(candidate, list):
            return [item for item in candidate if isinstance(item, dict)]

    data = automator_payload.get("data")
    if isinstance(data, dict):
        for key in ["changed_appliances", "affected_appliances", "appliances"]:
            candidate = data.get(key)
            if isinstance(candidate, list):
                return [item for item in candidate if isinstance(item, dict)]

    appliance = automator_payload.get("appliance")
    if isinstance(appliance, dict):
        return [appliance]

    if isinstance(data, dict) and isinstance(data.get("appliance"), dict):
        return [data.get("appliance")]

    return []


def build_confirmation_text(
    changed_appliances: list[dict[str, Any]],
    forecast_summary: Optional[dict[str, Any]],
) -> str:
    if not changed_appliances:
        return "No active appliance was changed."

    names = [str(item.get("name") or item.get("id") or "Unknown appliance") for item in changed_appliances]
    base = f"Turned off: {', '.join(names)}."

    if not forecast_summary:
        return base

    risk_level = forecast_summary.get("riskLevel")
    projected_cost = forecast_summary.get("projectedCost")

    extras = []
    if isinstance(risk_level, str) and risk_level.strip():
        extras.append(f"risk: {risk_level}")
    if isinstance(projected_cost, (int, float)):
        extras.append(f"projected month-end: ${float(projected_cost):.2f}")

    if not extras:
        return base

    return f"{base} Forecast {' | '.join(extras)}."


def publish_appliance_state_changed(uid: str, target_state: str, changed_appliances: list[dict[str, Any]]) -> Optional[dict[str, Any]]:
    names = [str(item.get("name") or item.get("id") or "unknown") for item in changed_appliances]
    message = f"ApplianceStateChanged: user requested {target_state} for {', '.join(names)}."

    payload = {
        "user_id": uid,
        "message": message,
        "occurred_at": to_iso_utc_now(),
    }

    response = request_with_fallback(
        "history",
        "POST",
        "/api/history/log",
        json_body=payload,
    )
    body = parse_response_json(response)
    if response.status_code not in {200, 201, 202}:
        raise RuntimeError(
            extract_error_message(body, f"history-service returned HTTP {response.status_code}"),
        )

    if isinstance(body, dict):
        return body
    return None


@app.route("/", methods=["GET"])
def home():
    return jsonify(
        {
            "status": "online",
            "service": "Request Change Composite",
            "endpoints": ["POST /api/request-change"],
        }
    ), 200


@app.route("/api/request-change", methods=["POST"])
def request_change():
    body = request.get_json(silent=True) or {}

    uid = str(body.get("uid") or DEFAULT_UID)
    target_state = str(body.get("target_state") or "OFF").upper()

    appliance_ids = body.get("appliance_ids")
    if appliance_ids is None:
        appliance_ids = body.get("aids")

    if appliance_ids is not None and not isinstance(appliance_ids, list):
        return jsonify({"success": False, "error": "appliance_ids must be an array when provided."}), 400

    automator_request = {
        "uid": uid,
        "target_state": target_state,
        "appliance_ids": appliance_ids,
    }

    try:
        automator_response = request_with_fallback(
            "automator",
            "POST",
            "/api/change-state/start",
            json_body=automator_request,
        )
        automator_payload = parse_response_json(automator_response)

        if automator_response.status_code not in {200, 201, 202}:
            return jsonify(
                {
                    "success": False,
                    "error": extract_error_message(
                        automator_payload,
                        f"change-state returned HTTP {automator_response.status_code}",
                    ),
                }
            ), 502

        if not isinstance(automator_payload, dict):
            automator_payload = {"raw": automator_payload}

        changed_appliances = pick_changed_appliances(automator_payload)
        forecast_summary = pick_forecast_summary(automator_payload)
        confirmation_text = build_confirmation_text(changed_appliances, forecast_summary)

        history_ack = None
        if changed_appliances:
            history_ack = publish_appliance_state_changed(uid, target_state, changed_appliances)

        return jsonify(
            {
                "success": True,
                "uid": uid,
                "target_state": target_state,
                "changed_appliances": changed_appliances,
                "forecast": forecast_summary,
                "confirmation_text": confirmation_text,
                "history": history_ack,
                "automator": automator_payload,
            }
        ), 200
    except requests.RequestException as error:
        return jsonify(
            {
                "success": False,
                "error": "Downstream service is unreachable",
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
    print(f"Request change composite service ready on port {PORT}", flush=True)
    app.run(host="0.0.0.0", port=PORT, debug=False)
