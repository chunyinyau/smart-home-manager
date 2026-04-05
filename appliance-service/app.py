import decimal
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy

from telemetry_replay import TelemetryReplayStore

DEMO_UID = "user_demo_001"
DEFAULT_SEED_FILE = Path("/app/seed/appliances.json")
DEFAULT_TELEMETRY_CSV = Path("/app/data/appliance_energy_data.csv")
DEFAULT_TELEMETRY_STATE_FILE = Path("/app/data/appliance_telemetry_state.json")

# In-memory dictionary to track manual test overrides
appliance_overrides = {}


def get_cors_origins():
    configured = [
        origin.strip()
        for origin in os.getenv("CORS_ORIGINS", "").split(",")
        if origin.strip()
    ]
    if configured:
        return configured

    return ["http://localhost:3000", "http://127.0.0.1:3000"]


def is_debug_enabled():
    return os.getenv("FLASK_DEBUG", "false").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": get_cors_origins()}})

app.config["SQLALCHEMY_DATABASE_URI"] = os.getenv(
    "DATABASE_URL", "sqlite:///appliance_local.db"
)
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

db = SQLAlchemy(app)

telemetry_store = TelemetryReplayStore(
    csv_path=os.getenv("APPLIANCE_TELEMETRY_CSV", str(DEFAULT_TELEMETRY_CSV)),
    state_path=os.getenv("APPLIANCE_TELEMETRY_STATE_FILE", str(DEFAULT_TELEMETRY_STATE_FILE)),
    interval_seconds=int(os.getenv("APPLIANCE_REPLAY_INTERVAL_SECONDS", "300")),
)

TELEMETRY_APPLIANCE_PROFILES = [
    {
        "id": "app_1",
        "name": "TV",
        "room": "Living Room",
        "type": "Entertainment",
        "priority": 3,
        "watts_key": "tv_w",
    },
    {
        "id": "app_2",
        "name": "Air Con",
        "room": "Bedroom",
        "type": "Cooling",
        "priority": 1,
        "watts_key": "air_conditioning_w",
    },
    {
        "id": "app_3",
        "name": "Lamp",
        "room": "Study",
        "type": "Lighting",
        "priority": 4,
        "watts_key": "light_w",
    },
    {
        "id": "app_4",
        "name": "Fridge",
        "room": "Kitchen",
        "type": "Essential",
        "priority": 1,
        "watts_key": "fridge_w",
    },
    {
        "id": "app_5",
        "name": "Smart Panel",
        "room": "Electrical Room",
        "type": "Infrastructure",
        "priority": 2,
        "watts_key": "smart_panel_w",
    },
]


class Appliance(db.Model):
    __tablename__ = "appliances"

    id = db.Column(db.String(32), primary_key=True)
    uid = db.Column(db.String(64), nullable=False, index=True)
    name = db.Column(db.String(120), nullable=False)
    room = db.Column(db.String(120), nullable=False)
    type = db.Column(db.String(120), nullable=False)
    state = db.Column(db.String(3), nullable=False)
    priority = db.Column(db.Integer, nullable=False)
    current_watts = db.Column(db.Integer, nullable=False)
    kwh_used = db.Column(db.Numeric(10, 4), nullable=False)
    last_seen_at = db.Column(db.String(32), nullable=False)

    def to_dict(self):
        return {
            "id": self.id,
            "uid": self.uid,
            "name": self.name,
            "room": self.room,
            "type": self.type,
            "state": self.state,
            "priority": self.priority,
            "currentWatts": self.current_watts,
            "kwhUsed": (
                float(self.kwh_used)
                if isinstance(self.kwh_used, decimal.Decimal)
                else self.kwh_used
            ),
            "lastSeenAt": self.last_seen_at,
        }


def current_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def default_seed_appliances() -> list[dict[str, object]]:
    return [
        {
            "id": "app_1",
            "uid": DEMO_UID,
            "name": "TV",
            "room": "Living Room",
            "type": "Entertainment",
            "state": "ON",
            "priority": 3,
            "currentWatts": 120,
            "kwhUsed": 0,
        },
        {
            "id": "app_2",
            "uid": DEMO_UID,
            "name": "Air Con",
            "room": "Bedroom",
            "type": "Cooling",
            "state": "ON",
            "priority": 1,
            "currentWatts": 1100,
            "kwhUsed": 0,
        },
        {
            "id": "app_3",
            "uid": DEMO_UID,
            "name": "Lamp",
            "room": "Study",
            "type": "Lighting",
            "state": "ON",
            "priority": 4,
            "currentWatts": 15,
            "kwhUsed": 0,
        },
        {
            "id": "app_4",
            "uid": DEMO_UID,
            "name": "Fridge",
            "room": "Kitchen",
            "type": "Essential",
            "state": "ON",
            "priority": 1,
            "currentWatts": 160,
            "kwhUsed": 0,
        },
        {
            "id": "app_5",
            "uid": DEMO_UID,
            "name": "Smart Panel",
            "room": "Electrical Room",
            "type": "Infrastructure",
            "state": "ON",
            "priority": 2,
            "currentWatts": 25,
            "kwhUsed": 0,
        },
    ]


def _to_non_negative_int(value: object) -> int:
    try:
        parsed = int(float(value))
        return max(parsed, 0)
    except (TypeError, ValueError):
        return 0


def sync_appliances_from_telemetry(uid: str) -> None:
    snapshot = telemetry_store.current()
    if snapshot.row is None:
        return

    telemetry_row = snapshot.row
    accrual = telemetry_store.accrual_for_current_sgt()
    per_device_accrued = accrual.get("perDeviceAccruedKwh", {}) if isinstance(accrual, dict) else {}
    tracked_ids = {profile["id"] for profile in TELEMETRY_APPLIANCE_PROFILES}

    existing = {
        appliance.id: appliance
        for appliance in Appliance.query.filter_by(uid=uid).all()
    }

    # Keep only the five canonical website appliances.
    for appliance_id, appliance in list(existing.items()):
        if appliance_id not in tracked_ids:
            db.session.delete(appliance)

    now_ts = current_timestamp()
    for profile in TELEMETRY_APPLIANCE_PROFILES:
        watts = _to_non_negative_int(telemetry_row.get(profile["watts_key"], 0))
        kwh_used = 0.0
        try:
            kwh_used = round(float(per_device_accrued.get(profile["watts_key"], 0.0)), 4)
        except (TypeError, ValueError):
            kwh_used = 0.0

        state = "ON" if watts > 0 else "OFF"

        if profile["id"] in appliance_overrides:
            state = appliance_overrides[profile["id"]]
            if state == "OFF":
                watts = 0
            elif state == "ON" and watts == 0:
                watts = 100

        appliance = existing.get(profile["id"])
        if appliance is None:
            appliance = Appliance(
                id=profile["id"],
                uid=uid,
                name=profile["name"],
                room=profile["room"],
                type=profile["type"],
                state=state,
                priority=profile["priority"],
                current_watts=watts,
                kwh_used=kwh_used,
                last_seen_at=now_ts,
            )
            db.session.add(appliance)
            continue

        appliance.name = profile["name"]
        appliance.room = profile["room"]
        appliance.type = profile["type"]
        appliance.priority = profile["priority"]
        appliance.state = state
        appliance.current_watts = watts
        appliance.kwh_used = kwh_used
        appliance.last_seen_at = now_ts

    db.session.commit()


def load_seed_appliances() -> list[dict[str, object]]:
    seed_file = Path(os.getenv("APPLIANCE_SEED_FILE", str(DEFAULT_SEED_FILE)))

    if seed_file.exists():
        try:
            payload = json.loads(seed_file.read_text(encoding="utf-8"))
            if isinstance(payload, list):
                return payload
            print("APPLIANCE_SEED_FILE must contain a JSON array. Falling back to defaults.")
        except Exception as error:
            print(f"Could not read appliance seed file: {error}. Falling back to defaults.")

    return default_seed_appliances()


def seed_appliances() -> None:
    if Appliance.query.first():
        return

    seed_time = current_timestamp()
    seed_records = load_seed_appliances()
    db.session.add_all(
        [
            Appliance(
                id=str(record.get("id", "")),
                uid=str(record.get("uid", DEMO_UID)),
                name=str(record.get("name", "Unnamed Appliance")),
                room=str(record.get("room", "Unknown")),
                type=str(record.get("type", "Unknown")),
                state=str(record.get("state", "OFF")),
                priority=int(record.get("priority", 99)),
                current_watts=int(record.get("currentWatts", 0)),
                kwh_used=float(record.get("kwhUsed", 0)),
                last_seen_at=str(record.get("lastSeenAt", seed_time)),
            )
            for record in seed_records
            if str(record.get("id", "")).strip()
        ]
    )
    db.session.commit()


def get_appliance_or_404(aid: str):
    appliance = db.session.get(Appliance, aid)
    if appliance is None:
        return None, (jsonify({"error": "Appliance not found."}), 404)
    return appliance, None


@app.route("/", methods=["GET"])
def home():
    return jsonify(
        {
            "status": "online",
            "service": "Appliance Microservice",
            "endpoints": [
                "/api/appliance",
                "/api/appliance/<aid>",
                "/api/appliance/<aid>/shutdown",
                "/api/appliance/<aid>/state",
                "/api/appliance/<aid>/priority",
            ],
        }
    )


@app.route("/api/appliance", methods=["GET"])
def get_appliances():
    uid = request.args.get("uid", DEMO_UID)
    sync_appliances_from_telemetry(uid)
    appliances = (
        Appliance.query.filter_by(uid=uid)
        .order_by(Appliance.priority.asc(), Appliance.id.asc())
        .all()
    )
    return jsonify([appliance.to_dict() for appliance in appliances])


@app.route("/api/appliance/<aid>", methods=["GET"])
def get_appliance(aid: str):
    appliance, error_response = get_appliance_or_404(aid)
    if error_response:
        return error_response
    return jsonify(appliance.to_dict())


@app.route("/api/appliance/<aid>/shutdown", methods=["POST"])
def shutdown_appliance(aid: str):
    appliance, error_response = get_appliance_or_404(aid)
    if error_response:
        return error_response

    appliance_overrides[aid] = "OFF"
    appliance.state = "OFF"
    appliance.current_watts = 0
    appliance.last_seen_at = current_timestamp()
    db.session.commit()
    return jsonify(appliance.to_dict())

@app.route("/api/appliance/<aid>/state", methods=["PATCH"])
def update_state(aid: str):
    appliance, error_response = get_appliance_or_404(aid)
    if error_response:
        return error_response

    payload = request.get_json(silent=True) or {}
    target_state = payload.get("state", "OFF")

    appliance_overrides[aid] = target_state
    appliance.state = target_state
    if target_state == "OFF":
        appliance.current_watts = 0
    elif target_state == "ON" and appliance.current_watts == 0:
        appliance.current_watts = 100

    appliance.last_seen_at = current_timestamp()
    db.session.commit()
    return jsonify(appliance.to_dict())


@app.route("/api/appliance/<aid>/priority", methods=["PATCH"])
def update_priority(aid: str):
    appliance, error_response = get_appliance_or_404(aid)
    if error_response:
        return error_response

    payload = request.get_json(silent=True) or {}
    priority = payload.get("priority")

    try:
        priority_value = int(priority)
    except (TypeError, ValueError):
        return jsonify({"error": "priority must be a number."}), 400

    appliance.priority = priority_value
    appliance.last_seen_at = current_timestamp()
    db.session.commit()
    return jsonify(appliance.to_dict())


@app.route("/api/appliance/summary", methods=["GET"])
def appliance_summary():
    uid = request.args.get("uid", DEMO_UID)
    sync_appliances_from_telemetry(uid)
    appliances = Appliance.query.filter_by(uid=uid).all()
    active_count = sum(1 for appliance in appliances if appliance.state == "ON")
    total_watts = sum(appliance.current_watts for appliance in appliances)
    total_kwh = sum(float(appliance.kwh_used) for appliance in appliances)

    return jsonify(
        {
            "uid": uid,
            "activeCount": active_count,
            "totalWatts": total_watts,
            "totalKwh": round(total_kwh, 2),
        }
    )


@app.route("/api/appliance/telemetry/status", methods=["GET"])
def telemetry_status():
    return jsonify(telemetry_store.status())


@app.route("/api/appliance/telemetry/current", methods=["GET"])
def telemetry_current():
    snapshot = telemetry_store.current()
    if snapshot.row is None:
        return jsonify({"error": "Telemetry CSV is empty."}), 404

    return jsonify(
        {
            "index": snapshot.index,
            "totalRows": snapshot.total_rows,
            "completed": snapshot.completed,
            "data": snapshot.row,
        }
    )


@app.route("/api/appliance/telemetry/accrual", methods=["GET"])
def telemetry_accrual():
    return jsonify(telemetry_store.accrual_for_current_sgt())


@app.route("/api/appliance/telemetry/advance", methods=["POST"])
def telemetry_advance():
    payload = request.get_json(silent=True) or {}
    try:
        step = int(payload.get("step", 1))
    except (TypeError, ValueError):
        return jsonify({"error": "step must be a number."}), 400

    snapshot = telemetry_store.advance(step=step)
    if snapshot.row is None:
        return jsonify({"error": "Telemetry CSV is empty."}), 404

    return jsonify(
        {
            "index": snapshot.index,
            "totalRows": snapshot.total_rows,
            "completed": snapshot.completed,
            "data": snapshot.row,
        }
    )


@app.route("/api/appliance/telemetry/reset", methods=["POST"])
def telemetry_reset():
    snapshot = telemetry_store.reset()
    if snapshot.row is None:
        return jsonify({"error": "Telemetry CSV is empty."}), 404

    return jsonify(
        {
            "index": snapshot.index,
            "totalRows": snapshot.total_rows,
            "completed": snapshot.completed,
            "data": snapshot.row,
        }
    )


if __name__ == "__main__":
    with app.app_context():
        db.create_all()
        seed_appliances()

    telemetry_store.start()

    print("Appliance microservice is ready on port 5002!", flush=True)
    app.run(
        host="0.0.0.0",
        port=5002,
        debug=is_debug_enabled(),
        use_reloader=False,
    )
