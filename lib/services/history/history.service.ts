import { DEMO_UID } from "@/lib/shared/constants";
import { listHistoryByUser } from "./history.repo";
import { ensureHistoryLogConsumerStarted, publishHistoryLogEvent } from "./history.queue";

function normalizeUserId(uid: string | number | null | undefined): string {
  if (typeof uid === "string" && uid.trim().length > 0) {
    return uid;
  }
  if (typeof uid === "number" && Number.isFinite(uid)) {
    return String(uid);
  }
  return DEMO_UID;
}

function warnHistoryConsumer() {
  void ensureHistoryLogConsumerStarted().catch((error) => {
    console.warn("History consumer is not running on RabbitMQ. Using fallback mode.", error);
  });
}

export function getHistory(uid: string | number | null | undefined) {
  warnHistoryConsumer();
  return listHistoryByUser(normalizeUserId(uid));
}

export async function logHistory(
  uid: string | number | null | undefined,
  message: string,
) {
  warnHistoryConsumer();
  return publishHistoryLogEvent({
    user_id: normalizeUserId(uid),
    message,
  });
}
