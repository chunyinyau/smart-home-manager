import os
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import urljoin

import requests
from flask import Flask, jsonify, request
from flask_cors import CORS


PORT = int(os.getenv("PORT", "5010"))
APPLIANCE_SERVICE_URL = os.getenv("APPLIANCE_SERVICE_URL", "http://appliance_service:5002")
FORECASTBILL_SERVICE_URL = os.getenv("FORECASTBILL_SERVICE_URL", "http://forecastbill_service:5009")
REQUEST_TIMEOUT_SECONDS = float(os.getenv("REQUEST_TIMEOUT_SECONDS", "8"))
DEFAULT_UID = os.getenv("DEFAULT_UID", "user_demo_001")
DEFAULT_MAX_SHUTDOWNS = int(os.getenv("DEFAULT_MAX_SHUTDOWNS", "1"))

SERVICE_FALLBACK_URLS = {
    "appliance": [
        APPLIANCE_SERVICE_URL,
        "http://host.docker.internal:5002",
        "http://127.0.0.1:5002",
        "http://localhost:5002",
    ],
    "forecastbill": [
        FORECASTBILL_SERVICE_URL,
        "http://host.docker.internal:5009",
        "http://127.0.0.1:5009",
        "http://localhost:5009",
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


def is_untrusted_host_400(response: requests.Response) -> bool:
    if response.status_code != 400:
        return False
    body = response.text or ""
    return "is not trusted" in body and "Host" in body


def to_positive_int(value: Any, fallback: int) -> int:
    try:
        parsed = int(value)
        if parsed > 0:
            return parsed
    except (TypeError, ValueError):
        pass
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
            if is_untrusted_host_400(response):
                continue
            return response
        except requests.RequestException as error:
            last_error = error

    if last_error:
        raise last_error
    raise RuntimeError(f"Unable to reach {service}-service across all configured base URLs")


def fetch_appliances(uid: str) -> list[dict[str, Any]]:
    response = request_with_fallback(
        "appliance",
        "GET",
        "/api/appliance",
        params={"uid": uid},
    )
    payload = parse_response_json(response)
    if response.status_code != 200 or not isinstance(payload, list):
        raise RuntimeError(
            extract_error_message(payload, f"appliance-service returned HTTP {response.status_code}"),
        )
    return [item for item in payload if isinstance(item, dict)]


def shutdown_appliance(aid: str) -> Optional[dict[str, Any]]:
    response = request_with_fallback(
        "appliance",
        "POST",
        f"/api/appliance/{aid}/shutdown",
    )
    payload = parse_response_json(response)

    if response.status_code == 404:
        return None

    if response.status_code not in {200, 201} or not isinstance(payload, dict):
        raise RuntimeError(
            extract_error_message(payload, f"appliance-service shutdown returned HTTP {response.status_code}"),
        )
    return payload


def fetch_forecast(uid: str) -> Optional[dict[str, Any]]:
    response = request_with_fallback(
        "forecastbill",
        "GET",
        "/api/forecast",
        params={"uid": uid},
    )
    payload = parse_response_json(response)
    if response.status_code != 200 or not isinstance(payload, dict):
        return None
    return payload


def select_targets(
    appliances: list[dict[str, Any]],
    appliance_ids: Optional[list[str]],
    max_shutdowns: int,
) -> list[dict[str, Any]]:
    online = [a for a in appliances if str(a.get("state", "")).upper() == "ON"]

    if appliance_ids:
        wanted = {str(aid) for aid in appliance_ids}
        return [a for a in online if str(a.get("id")) in wanted]

    ranked = sorted(
        online,
        key=lambda a: (
            -int(float(a.get("currentWatts", 0) or 0)),
            -int(float(a.get("priority", 0) or 0)),
        ),
    )
    return ranked[:max_shutdowns]


def iso_utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


@app.route("/", methods=["GET"])
def home():
    return jsonify(
        {
            "status": "online",
            "service": "State Change Automator Composite",
            "endpoints": ["POST /api/state-change-automator/start"],
        }
    ), 200


@app.route("/api/state-change-automator/start", methods=["POST"])
def start_automator():
    body = request.get_json(silent=True) or {}

    uid = str(body.get("uid") or DEFAULT_UID)
    target_state = str(body.get("target_state") or "OFF").upper()
    max_shutdowns = to_positive_int(body.get("max_shutdowns"), DEFAULT_MAX_SHUTDOWNS)

    appliance_ids = body.get("appliance_ids")
    if appliance_ids is not None and not isinstance(appliance_ids, list):
        return jsonify({"success": False, "error": "appliance_ids must be an array when provided."}), 400

    try:
        appliances = fetch_appliances(uid)

        if target_state != "OFF":
            return jsonify(
                {
                    "success": False,
                    "error": "Only target_state=OFF is supported in current automator version.",
                }
            ), 400

        targets = select_targets(
            appliances,
            [str(item) for item in appliance_ids] if isinstance(appliance_ids, list) else None,
            max_shutdowns,
        )

        changed_appliances: list[dict[str, Any]] = []
        for target in targets:
            aid = str(target.get("id") or "")
            if not aid:
                continue
            updated = shutdown_appliance(aid)
            if updated:
                changed_appliances.append(updated)

        forecast = fetch_forecast(uid)

        return jsonify(
            {
                "success": True,
                "uid": uid,
                "target_state": target_state,
                "requested_at": iso_utc_now(),
                "changed_appliances": changed_appliances,
                "appliance_count": len(changed_appliances),
                "forecast": forecast,
                "message": (
                    "No active appliance was available for shutdown."
                    if len(changed_appliances) == 0
                    else f"Shut down {len(changed_appliances)} appliance(s)."
                ),
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
    print(f"State change automator service ready on port {PORT}", flush=True)
    app.run(host="0.0.0.0", port=PORT, debug=False)
