import { DEMO_UID } from "@/lib/shared/constants";
import type { HistoryLogEvent, HistoryRecord } from "./history.types";

const historyLog: HistoryRecord[] = [
  {
    log_id: 1,
    user_id: DEMO_UID,
    message: "Meter reading extracted and usage refreshed.",
    occurred_at: new Date(Date.now() - 1000 * 60 * 10).toISOString(),
  },
];

let nextLogId = historyLog.length + 1;

export function listHistoryByUser(userId: string) {
  return historyLog
    .filter((entry) => entry.user_id === userId)
    .sort(
      (left, right) =>
        new Date(right.occurred_at).getTime() -
        new Date(left.occurred_at).getTime(),
    )
    .map((entry) => ({ ...entry }));
}

export function appendHistoryEntry(event: HistoryLogEvent) {
  const record: HistoryRecord = {
    log_id: nextLogId,
    user_id: event.user_id,
    message: event.message,
    occurred_at: event.occurred_at ?? new Date().toISOString(),
  };
  nextLogId += 1;
  historyLog.push(record);
  return { ...record };
}
