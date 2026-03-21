import { addHistoryEntry, listHistoryByUser } from "./history.repo";

export function getHistory(uid: string) {
  return listHistoryByUser(uid);
}

export function logHistory(
  uid: string,
  eventType: string,
  eventSource: string,
  message: string,
  targetApplianceId?: string,
) {
  return addHistoryEntry({
    uid,
    eventType,
    eventSource,
    message,
    targetApplianceId,
  });
}
