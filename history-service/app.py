import json
import os
import threading
import time
from datetime import datetime, timezone
from typing import Any

import pika
from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy.exc import OperationalError

DEMO_UID = "user_demo_001"
HISTORY_EVENTS_QUEUE = os.getenv("HISTORY_EVENTS_QUEUE", "history.events.v1")
RABBITMQ_RETRY_SECONDS = int(os.getenv("RABBITMQ_RETRY_SECONDS", "5"))


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
    "DATABASE_URL", "sqlite:///history_local.db"
)
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

db = SQLAlchemy(app)


class HistoryLog(db.Model):
    __tablename__ = "history_logs"

    log_id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    user_id = db.Column(db.String(64), nullable=False, index=True)
    message = db.Column(db.Text, nullable=False)
    occurred_at = db.Column(db.DateTime(timezone=True), nullable=False, index=True)

    def to_dict(self):
        occurred = self.occurred_at
        if occurred.tzinfo is None:
            occurred = occurred.replace(tzinfo=timezone.utc)
        else:
            occurred = occurred.astimezone(timezone.utc)

        return {
            "log_id": self.log_id,
            "user_id": self.user_id,
            "message": self.message,
            "occurred_at": occurred.isoformat().replace("+00:00", "Z"),
        }


def utc_now_iso() -> str:
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


def parse_occurred_at(value: Any) -> datetime:
    if value is None:
        return datetime.now(timezone.utc)

    if not isinstance(value, str) or not value.strip():
        raise ValueError("occurred_at must be an ISO datetime string when provided")

    normalized = value.strip().replace("Z", "+00:00")
    parsed = datetime.fromisoformat(normalized)

    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)

    return parsed.astimezone(timezone.utc)


def normalize_history_event(payload: dict[str, Any]) -> dict[str, Any]:
    user_id_raw = payload.get("user_id", payload.get("uid", DEMO_UID))
    message_raw = payload.get("message")

    user_id = str(user_id_raw).strip() if user_id_raw is not None else ""
    if not user_id:
        user_id = DEMO_UID

    if not isinstance(message_raw, str) or not message_raw.strip():
        raise ValueError("message must be a non-empty string")

    normalized_event = {
        "user_id": user_id,
        "message": message_raw.strip(),
        "occurred_at": parse_occurred_at(payload.get("occurred_at")),
    }
    return normalized_event


def persist_history_event(payload: dict[str, Any]) -> HistoryLog:
    normalized = normalize_history_event(payload)

    row = HistoryLog(
        user_id=normalized["user_id"],
        message=normalized["message"],
        occurred_at=normalized["occurred_at"],
    )
    db.session.add(row)
    db.session.commit()
    return row


def seed_history_if_empty() -> None:
    if HistoryLog.query.first():
        return

    db.session.add(
        HistoryLog(
            user_id=DEMO_UID,
            message="Meter reading extracted and usage refreshed.",
            occurred_at=datetime.now(timezone.utc),
        )
    )
    db.session.commit()


def connect_rabbitmq() -> pika.BlockingConnection:
    urls = get_rabbitmq_url_candidates()
    last_error: Exception | None = None

    for url in urls:
        try:
            connection = pika.BlockingConnection(pika.URLParameters(url))
            print(f"Connected to RabbitMQ at {url}", flush=True)
            return connection
        except Exception as error:
            last_error = error

    raise RuntimeError(
        f"Unable to connect to RabbitMQ using configured URLs ({', '.join(urls)}). Last error: {last_error}"
    )


def publish_history_event(payload: dict[str, Any]) -> None:
    normalized = normalize_history_event(payload)

    body = json.dumps(
        {
            "user_id": normalized["user_id"],
            "message": normalized["message"],
            "occurred_at": normalized["occurred_at"].isoformat().replace("+00:00", "Z"),
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


def consume_history_events_forever() -> None:
    while True:
        connection: pika.BlockingConnection | None = None
        try:
            connection = connect_rabbitmq()
            channel = connection.channel()
            channel.queue_declare(queue=HISTORY_EVENTS_QUEUE, durable=True)
            channel.basic_qos(prefetch_count=20)

            def on_message(ch, method, properties, body):
                del properties
                try:
                    payload = json.loads(body.decode("utf-8"))
                    if not isinstance(payload, dict):
                        raise ValueError("payload must be a JSON object")

                    with app.app_context():
                        persist_history_event(payload)

                    ch.basic_ack(delivery_tag=method.delivery_tag)
                except ValueError as error:
                    print(f"Skipping invalid history message: {error}", flush=True)
                    ch.basic_ack(delivery_tag=method.delivery_tag)
                except Exception as error:
                    print(f"Error processing history message: {error}", flush=True)
                    ch.basic_nack(delivery_tag=method.delivery_tag, requeue=True)

            channel.basic_consume(
                queue=HISTORY_EVENTS_QUEUE,
                on_message_callback=on_message,
                auto_ack=False,
            )
            print("History RabbitMQ consumer is running", flush=True)
            channel.start_consuming()
        except Exception as error:
            print(
                f"History RabbitMQ consumer disconnected: {error}. Retrying in {RABBITMQ_RETRY_SECONDS}s",
                flush=True,
            )
            time.sleep(RABBITMQ_RETRY_SECONDS)
        finally:
            if connection and connection.is_open:
                connection.close()


def should_start_background_workers() -> bool:
    if not app.debug:
        return True

    return os.environ.get("WERKZEUG_RUN_MAIN") == "true"


def start_consumer_thread() -> None:
    consumer_thread = threading.Thread(
        target=consume_history_events_forever,
        name="history-rabbitmq-consumer",
        daemon=True,
    )
    consumer_thread.start()


def wait_for_db(retries=10, delay=5):
    print("Waiting for History DB to be ready...", flush=True)
    for attempt in range(1, retries + 1):
        try:
            with app.app_context():
                db.create_all()
                seed_history_if_empty()
            print("History DB is ready.", flush=True)
            return True
        except OperationalError:
            print(
                f"History DB not ready (attempt {attempt}/{retries}) - retrying in {delay}s",
                flush=True,
            )
            time.sleep(delay)

    return False


@app.route("/", methods=["GET"])
def home():
    return jsonify(
        {
            "status": "online",
            "service": "History Microservice",
            "endpoints": ["/api/history", "/api/history/log"],
        }
    )


@app.route("/api/history", methods=["GET"])
def list_history():
    user_id = request.args.get("user_id") or request.args.get("uid") or DEMO_UID

    rows = (
        HistoryLog.query.filter_by(user_id=user_id)
        .order_by(HistoryLog.occurred_at.desc(), HistoryLog.log_id.desc())
        .all()
    )
    return jsonify([row.to_dict() for row in rows])


@app.route("/api/history/log", methods=["POST"])
def log_history():
    payload = request.get_json(silent=True) or {}

    try:
        publish_history_event(payload)
        return jsonify({"accepted": True, "queued_at": utc_now_iso()}), 202
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    except Exception as error:
        # Keep service available even if RabbitMQ is temporarily down.
        try:
            row = persist_history_event(payload)
            return (
                jsonify(
                    {
                        "accepted": True,
                        "queued_at": row.to_dict()["occurred_at"],
                        "fallback": True,
                    }
                ),
                202,
            )
        except Exception as fallback_error:
            db.session.rollback()
            return (
                jsonify(
                    {
                        "error": "Failed to log history event",
                        "details": str(error),
                        "fallback_error": str(fallback_error),
                    }
                ),
                500,
            )


if __name__ == "__main__":
    if wait_for_db():
        if should_start_background_workers():
            start_consumer_thread()

        print("History microservice is ready on port 5005", flush=True)
        app.run(host="0.0.0.0", port=5005, debug=is_debug_enabled())
    else:
        print("Could not connect to history database after retries. Exiting.", flush=True)
