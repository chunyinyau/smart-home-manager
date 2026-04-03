import type {
  HistoryLogEvent,
  HistoryQueueAck,
  HistoryRecord,
} from "@/lib/services/history/history.types";
import {
  extractErrorMessage,
  fetchService,
  readJsonBody,
} from "@/lib/clients/service-discovery";

async function readErrorMessage(response: Response) {
  const payload = await readJsonBody<Record<string, unknown>>(response);
  return extractErrorMessage(payload, "History microservice returned an error");
}

export async function fetchHistoryByUser(userId: string): Promise<HistoryRecord[]> {
  const response = await fetchService(
    "history",
    `/api/history?user_id=${encodeURIComponent(userId)}`,
  );

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return (await response.json()) as HistoryRecord[];
}

export async function publishHistoryLogEvent(
  event: HistoryLogEvent,
): Promise<HistoryQueueAck> {
  const response = await fetchService("history", "/api/history/log", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(event),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return (await response.json()) as HistoryQueueAck;
}
