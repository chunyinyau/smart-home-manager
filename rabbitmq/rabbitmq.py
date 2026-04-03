import json
import os
import time
from typing import Any, Callable

import pika

HISTORY_EVENTS_QUEUE = os.getenv("HISTORY_EVENTS_QUEUE", "history.events.v1")
RABBITMQ_RETRY_SECONDS = int(os.getenv("RABBITMQ_RETRY_SECONDS", "5"))


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
            print(f"Connected to RabbitMQ at {url}", flush=True)
            return connection
        except Exception as error:
            last_error = error

    raise RuntimeError(
        f"Unable to connect to RabbitMQ using configured URLs ({', '.join(urls)}). Last error: {last_error}"
    )


def publish_history_event(
    payload: dict[str, Any],
    normalize_history_event: Callable[[dict[str, Any]], dict[str, Any]],
) -> None:
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


def consume_history_events_forever(
    process_history_event: Callable[[dict[str, Any]], None],
) -> None:
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

                    process_history_event(payload)
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
