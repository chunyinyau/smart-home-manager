import "server-only";

import amqp, { type Channel, type ConsumeMessage } from "amqplib";
import { appendHistoryEntry } from "./history.repo";
import type { HistoryLogEvent, HistoryQueueAck } from "./history.types";

const HISTORY_EVENTS_QUEUE = process.env.HISTORY_EVENTS_QUEUE ?? "history.events.v1";

const DEFAULT_RABBITMQ_URLS = [
  "amqp://guest:guest@localhost:5672",
  "amqp://guest:guest@127.0.0.1:5672",
  "amqp://guest:guest@rabbitmq:5672",
];

let rabbitChannel: Channel | null = null;
let channelInitPromise: Promise<Channel> | null = null;
let consumerStartPromise: Promise<void> | null = null;

const fallbackQueue: HistoryLogEvent[] = [];
let isDrainingFallbackQueue = false;

function getRabbitMqUrlCandidates(): string[] {
  const configuredList = process.env.RABBITMQ_URLS
    ?.split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (configuredList && configuredList.length > 0) {
    return configuredList;
  }

  const singleUrl = process.env.RABBITMQ_URL?.trim();
  if (singleUrl) {
    return [singleUrl];
  }

  return DEFAULT_RABBITMQ_URLS;
}

function resetRabbitState() {
  rabbitChannel = null;
  channelInitPromise = null;
  consumerStartPromise = null;
}

function isHistoryLogEvent(payload: unknown): payload is HistoryLogEvent {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  const candidate = payload as Record<string, unknown>;
  const hasUserId = typeof candidate.user_id === "string" && candidate.user_id.trim().length > 0;
  const hasMessage = typeof candidate.message === "string" && candidate.message.trim().length > 0;
  const hasOccurredAt =
    candidate.occurred_at === undefined ||
    (typeof candidate.occurred_at === "string" && candidate.occurred_at.length > 0);

  return hasUserId && hasMessage && hasOccurredAt;
}

function enqueueFallbackEvent(event: HistoryLogEvent) {
  fallbackQueue.push(event);
  if (isDrainingFallbackQueue) {
    return;
  }

  isDrainingFallbackQueue = true;
  queueMicrotask(() => {
    while (fallbackQueue.length > 0) {
      const nextEvent = fallbackQueue.shift();
      if (!nextEvent) {
        continue;
      }

      appendHistoryEntry(nextEvent);
    }

    isDrainingFallbackQueue = false;
  });
}

async function createChannel(): Promise<Channel> {
  const urls = getRabbitMqUrlCandidates();
  let lastError: unknown = null;

  for (const url of urls) {
    try {
      const connection = await amqp.connect(url);
      const channel = await connection.createChannel();
      await channel.assertQueue(HISTORY_EVENTS_QUEUE, { durable: true });

      connection.on("close", () => {
        resetRabbitState();
      });

      connection.on("error", () => {
        resetRabbitState();
      });

      channel.on("close", () => {
        resetRabbitState();
      });

      channel.on("error", () => {
        resetRabbitState();
      });

      rabbitChannel = channel;
      return channel;
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `Unable to connect to RabbitMQ using configured URLs (${urls.join(", ")}). Last error: ${String(lastError)}`,
  );
}

async function getRabbitChannel(): Promise<Channel> {
  if (rabbitChannel) {
    return rabbitChannel;
  }

  if (!channelInitPromise) {
    channelInitPromise = createChannel();
  }

  try {
    return await channelInitPromise;
  } finally {
    if (!rabbitChannel) {
      channelInitPromise = null;
    }
  }
}

async function handleHistoryMessage(message: ConsumeMessage, channel: Channel) {
  try {
    const payload = JSON.parse(message.content.toString("utf8")) as unknown;
    if (!isHistoryLogEvent(payload)) {
      channel.ack(message);
      return;
    }

    appendHistoryEntry(payload);
    channel.ack(message);
  } catch (error) {
    console.error("HISTORY CONSUMER ERROR:", error);
    channel.nack(message, false, true);
  }
}

export async function ensureHistoryLogConsumerStarted() {
  if (consumerStartPromise) {
    return consumerStartPromise;
  }

  consumerStartPromise = (async () => {
    const channel = await getRabbitChannel();
    await channel.prefetch(20);
    await channel.consume(
      HISTORY_EVENTS_QUEUE,
      async (message) => {
        if (!message) {
          return;
        }

        await handleHistoryMessage(message, channel);
      },
      { noAck: false },
    );
  })();

  try {
    await consumerStartPromise;
  } catch (error) {
    consumerStartPromise = null;
    throw error;
  }
}

export async function publishHistoryLogEvent(
  event: HistoryLogEvent,
): Promise<HistoryQueueAck> {
  const publishableEvent: HistoryLogEvent = {
    ...event,
    occurred_at: event.occurred_at ?? new Date().toISOString(),
  };

  try {
    const channel = await getRabbitChannel();
    const sent = channel.sendToQueue(
      HISTORY_EVENTS_QUEUE,
      Buffer.from(JSON.stringify(publishableEvent)),
      {
        persistent: true,
        contentType: "application/json",
      },
    );

    if (!sent) {
      await new Promise<void>((resolve) => {
        channel.once("drain", () => resolve());
      });
    }
  } catch (error) {
    console.warn("RabbitMQ publish failed. Falling back to in-memory append:", error);
    enqueueFallbackEvent(publishableEvent);
  }

  return {
    accepted: true,
    queued_at: new Date().toISOString(),
  };
}