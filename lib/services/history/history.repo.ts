import { DEMO_UID } from "@/lib/shared/constants";
import type { HistoryRecord } from "./history.types";

const historyLog: HistoryRecord[] = [
  {
    id: "log_1",
    uid: DEMO_UID,
    eventType: "OCR_UPDATE",
    eventSource: "system",
    message: "Meter reading extracted and usage refreshed.",
    createdAt: new Date(Date.now() - 1000 * 60 * 10).toISOString(),
  },
];

export function listHistoryByUser(uid: string) {
  return historyLog.filter((entry) => entry.uid === uid);
}

export function addHistoryEntry(entry: Omit<HistoryRecord, "id" | "createdAt">) {
  const record: HistoryRecord = {
    ...entry,
    id: `log_${historyLog.length + 1}`,
    createdAt: new Date().toISOString(),
  };
  historyLog.unshift(record);
  return record;
}
