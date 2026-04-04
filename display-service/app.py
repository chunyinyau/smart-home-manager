import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

import requests
from flask import Flask, jsonify, request
from flask_cors import CORS

# ==========================================
# Configuration
# ==========================================
BUDGET_SERVICE_URL    = os.getenv("BUDGET_SERVICE_URL",    "http://budget_service:5004")
HISTORY_SERVICE_URL   = os.getenv("HISTORY_SERVICE_URL",   "http://history_service:5005")
BILL_SERVICE_URL      = os.getenv("BILL_SERVICE_URL",      "http://bill_service:5003")
APPLIANCE_SERVICE_URL = os.getenv("APPLIANCE_SERVICE_URL", "http://appliance_service:5002")
FORECAST_SERVICE_URL  = os.getenv("FORECAST_SERVICE_URL",  "http://forecastbill_service:5009")
PROFILE_SERVICE_URL   = os.getenv(
    "PROFILE_SERVICE_URL",
    "https://personal-2nbikeej.outsystemscloud.com/Profile/rest/Profile/profile",
)

REQUEST_TIMEOUT = int(os.getenv("REQUEST_TIMEOUT_SECONDS", "8"))

SERVICE_FALLBACK_URLS = {
    "budget": [
        BUDGET_SERVICE_URL,
        "http://host.docker.internal:5004",
        "http://127.0.0.1:5004",
        "http://localhost:5004",
    ],
    "history": [
        HISTORY_SERVICE_URL,
        "http://host.docker.internal:5005",
        "http://127.0.0.1:5005",
        "http://localhost:5005",
    ],
    "bill": [
        BILL_SERVICE_URL,
        "http://host.docker.internal:5003",
        "http://127.0.0.1:5003",
        "http://localhost:5003",
    ],
    "appliance": [
        APPLIANCE_SERVICE_URL,
        "http://host.docker.internal:5002",
        "http://127.0.0.1:5002",
        "http://localhost:5002",
    ],
    "forecast": [
        FORECAST_SERVICE_URL,
        "http://host.docker.internal:5009",
        "http://127.0.0.1:5009",
        "http://localhost:5009",
    ],
}

# ==========================================
# Flask App
# ==========================================
app = Flask(__name__)
CORS(app)


def normalize_base_url(base_url: str) -> str:
    return base_url.strip().rstrip("/")


def is_untrusted_host_400(response: requests.Response) -> bool:
    if response.status_code != 400:
        return False
    body = response.text or ""
    return "is not trusted" in body and "Host" in body


def request_with_fallback(
    service: str,
    path: str,
    *,
    params: dict | None = None,
) -> requests.Response:
    candidates = [normalize_base_url(url) for url in SERVICE_FALLBACK_URLS[service] if url]
    seen = set()
    unique_candidates = []
    for candidate in candidates:
        if candidate in seen:
            continue
        seen.add(candidate)
        unique_candidates.append(candidate)

    last_error = None
    for base_url in unique_candidates:
        try:
            response = requests.get(
                f"{base_url}{path}",
                params=params,
                timeout=REQUEST_TIMEOUT,
            )
            if is_untrusted_host_400(response):
                continue
            return response
        except requests.RequestException as error:
            last_error = error

    if last_error:
        raise last_error
    raise RuntimeError(f"Unable to reach {service}-service across all configured base URLs")

# ==========================================
# Per-service Fetchers
# ==========================================
def fetch_budget(user_id: str) -> dict:
    """GET /api/budget/<user_id> from budget-service."""
    try:
        # budget-service uses integer user_id in the path
        numeric_id = int(user_id) if user_id.isdigit() else 1
        resp = request_with_fallback("budget", f"/api/budget/{numeric_id}")
        if resp.status_code == 200:
            payload = resp.json()
            return {"data": payload.get("data"), "error": None}
        return {"data": None, "error": f"budget-service returned {resp.status_code}"}
    except Exception as e:
        return {"data": None, "error": str(e)}


def fetch_history(user_id: str) -> dict:
    """GET /api/history?uid=<user_id> from history-service."""
    try:
        resp = request_with_fallback("history", "/api/history", params={"uid": user_id})
        if resp.status_code == 200:
            return {"data": resp.json(), "error": None}
        return {"data": None, "error": f"history-service returned {resp.status_code}"}
    except Exception as e:
        return {"data": None, "error": str(e)}


def fetch_bills(user_id: str) -> dict:
    """GET /api/bills from bill-service, filtered by user_id."""
    try:
        resp = request_with_fallback("bill", "/api/bills")
        if resp.status_code == 200:
            payload = resp.json()
            all_bills = payload.get("data", [])
            # Filter to this user's bills
            try:
                uid_int = int(user_id)
                user_bills = [b for b in all_bills if b.get("user_id") == uid_int]
            except (ValueError, TypeError):
                user_bills = all_bills
            return {"data": user_bills, "error": None}
        return {"data": None, "error": f"bill-service returned {resp.status_code}"}
    except Exception as e:
        return {"data": None, "error": str(e)}


def fetch_appliances(user_id: str) -> dict:
    """GET /api/appliance?uid=<user_id> from appliance-service."""
    try:
        resp = request_with_fallback("appliance", "/api/appliance", params={"uid": user_id})
        if resp.status_code == 200:
            return {"data": resp.json(), "error": None}
        return {"data": None, "error": f"appliance-service returned {resp.status_code}"}
    except Exception as e:
        return {"data": None, "error": str(e)}


def fetch_profile(profile_id: str) -> dict:
    """GET profile from OutSystems Profile service."""
    try:
        resp = requests.get(
            f"{PROFILE_SERVICE_URL}/{profile_id}/",
            timeout=REQUEST_TIMEOUT,
        )
        if resp.status_code == 200:
            payload = resp.json()
            return {"data": payload.get("data"), "error": None}
        return {"data": None, "error": f"profile-service returned {resp.status_code}"}
    except Exception as e:
        return {"data": None, "error": str(e)}


def fetch_forecast(user_id: str) -> dict:
    """GET /api/forecast?uid=<user_id> from forecastbill-service."""
    try:
        resp = request_with_fallback("forecast", "/api/forecast", params={"uid": user_id})
        if resp.status_code == 200:
            return {"data": resp.json(), "error": None}
        return {"data": None, "error": f"forecastbill-service returned {resp.status_code}"}
    except Exception as e:
        return {"data": None, "error": str(e)}


# ==========================================
# API Routes
# ==========================================
@app.route("/", methods=["GET"])
def home():
    return jsonify({
        "status": "online",
        "service": "Display Composite Microservice",
        "endpoints": ["GET /api/display"],
        "aggregates": ["budget", "forecast", "history", "bills", "appliances", "profile"],
    })


@app.route("/api/display", methods=["GET"])
def display():
    """
    Fan out parallel GET calls to all downstream services and merge
    into one unified payload for the Web UI.

    Query params:
        uid        - user identifier (default: "1")
        profile_id - profile identifier (default: "1")
    """
    uid        = request.args.get("uid", "1")
    profile_id = request.args.get("profile_id", "1")

    tasks = {
        "budget":     (fetch_budget,     uid),
        "forecast":   (fetch_forecast,   uid),
        "history":    (fetch_history,    uid),
        "bills":      (fetch_bills,      uid),
        "appliances": (fetch_appliances, uid),
        "profile":    (fetch_profile,    profile_id),
    }

    results = {}
    with ThreadPoolExecutor(max_workers=6) as executor:
        futures = {
            executor.submit(fn, arg): key
            for key, (fn, arg) in tasks.items()
        }
        for future in as_completed(futures):
            key = futures[future]
            try:
                results[key] = future.result()
            except Exception as e:
                results[key] = {"data": None, "error": str(e)}

    # Build unified payload
    payload = {
        "uid":         uid,
        "profile_id":  profile_id,
        "fetched_at":  datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "budget":      results.get("budget",     {}).get("data"),
        "forecast":    results.get("forecast",   {}).get("data"),
        "history":     results.get("history",    {}).get("data"),
        "bills":       results.get("bills",      {}).get("data"),
        "appliances":  results.get("appliances", {}).get("data"),
        "profile":     results.get("profile",    {}).get("data"),
        "_errors": {
            key: res.get("error")
            for key, res in results.items()
            if res.get("error")
        },
    }

    # Remove _errors key if there are none
    if not payload["_errors"]:
        del payload["_errors"]

    return jsonify(payload), 200


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "display-service"}), 200


# ==========================================
# Entrypoint
# ==========================================
if __name__ == "__main__":
    port = int(os.getenv("PORT", "5006"))
    debug = os.getenv("FLASK_DEBUG", "false").strip().lower() in {"1", "true", "yes", "on"}
    print(f"Display composite service starting on port {port}", flush=True)
    app.run(host="0.0.0.0", port=port, debug=debug)
