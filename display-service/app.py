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
PROFILE_SERVICE_URL   = os.getenv(
    "PROFILE_SERVICE_URL",
    "https://personal-2nbikeej.outsystemscloud.com/Profile/rest/Profile/profile",
)

REQUEST_TIMEOUT = int(os.getenv("REQUEST_TIMEOUT_SECONDS", "8"))

# ==========================================
# Flask App
# ==========================================
app = Flask(__name__)
CORS(app)

# ==========================================
# Per-service Fetchers
# ==========================================
def fetch_budget(user_id: str) -> dict:
    """GET /api/budget/<user_id> from budget-service."""
    try:
        # budget-service uses integer user_id in the path
        numeric_id = int(user_id) if user_id.isdigit() else 1
        resp = requests.get(
            f"{BUDGET_SERVICE_URL}/api/budget/{numeric_id}",
            timeout=REQUEST_TIMEOUT,
        )
        if resp.status_code == 200:
            payload = resp.json()
            return {"data": payload.get("data"), "error": None}
        return {"data": None, "error": f"budget-service returned {resp.status_code}"}
    except Exception as e:
        return {"data": None, "error": str(e)}


def fetch_history(user_id: str) -> dict:
    """GET /api/history?uid=<user_id> from history-service."""
    try:
        resp = requests.get(
            f"{HISTORY_SERVICE_URL}/api/history",
            params={"uid": user_id},
            timeout=REQUEST_TIMEOUT,
        )
        if resp.status_code == 200:
            return {"data": resp.json(), "error": None}
        return {"data": None, "error": f"history-service returned {resp.status_code}"}
    except Exception as e:
        return {"data": None, "error": str(e)}


def fetch_bills(user_id: str) -> dict:
    """GET /api/bills from bill-service, filtered by user_id."""
    try:
        resp = requests.get(
            f"{BILL_SERVICE_URL}/api/bills",
            timeout=REQUEST_TIMEOUT,
        )
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
        resp = requests.get(
            f"{APPLIANCE_SERVICE_URL}/api/appliance",
            params={"uid": user_id},
            timeout=REQUEST_TIMEOUT,
        )
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


# ==========================================
# API Routes
# ==========================================
@app.route("/", methods=["GET"])
def home():
    return jsonify({
        "status": "online",
        "service": "Display Composite Microservice",
        "endpoints": ["GET /api/display"],
        "aggregates": ["budget", "history", "bills", "profile"],
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
        "history":    (fetch_history,    uid),
        "bills":      (fetch_bills,      uid),
        "appliances": (fetch_appliances, uid),
        "profile":    (fetch_profile,    profile_id),
    }

    results = {}
    with ThreadPoolExecutor(max_workers=5) as executor:
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
