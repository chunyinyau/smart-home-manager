import { DEMO_UID } from "@/lib/shared/constants";
import {
  fetchHistoryByUser,
  publishHistoryLogEvent,
} from "@/lib/clients/history";

function normalizeUserId(uid: string | number | null | undefined): string {
  if (typeof uid === "string" && uid.trim().length > 0) {
    return uid;
  }
  if (typeof uid === "number" && Number.isFinite(uid)) {
    return String(uid);
  }
  return DEMO_UID;
}

export async function getHistory(uid: string | number | null | undefined) {
  return fetchHistoryByUser(normalizeUserId(uid));
}

export async function logHistory(
  uid: string | number | null | undefined,
  message: string,
  occurredAt?: string,
) {
  return publishHistoryLogEvent({
    user_id: normalizeUserId(uid),
    message,
    occurred_at: occurredAt,
  });
}
