import decimal
import os
from datetime import datetime, timezone

from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy

DEMO_UID = "user_demo_001"

app = Flask(__name__)
CORS(app)

app.config["SQLALCHEMY_DATABASE_URI"] = os.getenv(
    "DATABASE_URL", "sqlite:///appliance_local.db"
)
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

db = SQLAlchemy(app)


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


def seed_appliances() -> None:
    if Appliance.query.first():
        return

    seed_time = current_timestamp()
    db.session.add_all(
        [
            Appliance(
                id="app_1",
                uid=DEMO_UID,
                name="Main AC",
                room="Living Room",
                type="Cooling",
                state="ON",
                priority=1,
                current_watts=2500,
                kwh_used=84.5,
                last_seen_at=seed_time,
            ),
            Appliance(
                id="app_2",
                uid=DEMO_UID,
                name="Server Rack",
                room="Study",
                type="Essential",
                state="ON",
                priority=1,
                current_watts=800,
                kwh_used=52.3,
                last_seen_at=seed_time,
            ),
            Appliance(
                id="app_3",
                uid=DEMO_UID,
                name="Entertainment Unit",
                room="Living Room",
                type="Non-Essential",
                state="ON",
                priority=3,
                current_watts=450,
                kwh_used=23.1,
                last_seen_at=seed_time,
            ),
            Appliance(
                id="app_4",
                uid=DEMO_UID,
                name="Desk Lamp",
                room="Study",
                type="Non-Essential",
                state="ON",
                priority=4,
                current_watts=60,
                kwh_used=4.9,
                last_seen_at=seed_time,
            ),
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
                "/api/appliance/<aid>/priority",
            ],
        }
    )


@app.route("/api/appliance", methods=["GET"])
def get_appliances():
    uid = request.args.get("uid", DEMO_UID)
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

    appliance.state = "OFF"
    appliance.current_watts = 0
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


if __name__ == "__main__":
    with app.app_context():
        db.create_all()
        seed_appliances()

    print("✅ Appliance microservice is ready on port 5002!", flush=True)
    app.run(host="0.0.0.0", port=5002, debug=True)
