import { appendHistoryEntry } from "./history.repo";
import type { HistoryLogEvent, HistoryQueueAck } from "./history.types";

const pendingHistoryEvents: HistoryLogEvent[] = [];
let isDrainingQueue = false;

function drainQueue() {
  if (isDrainingQueue) {
    return;
  }

  isDrainingQueue = true;
  queueMicrotask(() => {
    while (pendingHistoryEvents.length > 0) {
      const nextEvent = pendingHistoryEvents.shift();
      if (!nextEvent) {
        continue;
      }

      appendHistoryEntry(nextEvent);
    }

    isDrainingQueue = false;
    if (pendingHistoryEvents.length > 0) {
      drainQueue();
    }
  });
}

export async function publishHistoryLogEvent(
  event: HistoryLogEvent,
): Promise<HistoryQueueAck> {
  pendingHistoryEvents.push(event);
  drainQueue();

  return {
    accepted: true,
    queued_at: new Date().toISOString(),
  };
}