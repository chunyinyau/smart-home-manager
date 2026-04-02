import type {
  HistoryLogEvent,
  HistoryQueueAck,
  HistoryRecord,
} from "@/lib/services/history/history.types";

const HISTORY_SERVICE_URL =
  process.env.HISTORY_SERVICE_URL ?? "http://127.0.0.1:5005";

function buildHistoryUrl(path: string) {
  return `${HISTORY_SERVICE_URL}${path}`;
}

async function readErrorMessage(response: Response) {
  try {
    const payload = (await response.json()) as { error?: string; message?: string };
    return payload.error ?? payload.message ?? null;
  } catch {
    return null;
  }
}

export async function fetchHistoryByUser(userId: string): Promise<HistoryRecord[]> {
  const response = await fetch(
    buildHistoryUrl(`/api/history?user_id=${encodeURIComponent(userId)}`),
    {
      cache: "no-store",
    },
  );

  if (!response.ok) {
    const message = await readErrorMessage(response);
    throw new Error(message ?? "History microservice returned an error");
  }

  return (await response.json()) as HistoryRecord[];
}

export async function publishHistoryLogEvent(
  event: HistoryLogEvent,
): Promise<HistoryQueueAck> {
  const response = await fetch(buildHistoryUrl("/api/history/log"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(event),
    cache: "no-store",
  });

  if (!response.ok) {
    const message = await readErrorMessage(response);
    throw new Error(message ?? "History microservice returned an error");
  }

  return (await response.json()) as HistoryQueueAck;
}
