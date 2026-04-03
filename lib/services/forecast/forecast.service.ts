import {
  extractErrorMessage,
  fetchService,
  readJsonBody,
} from "@/lib/clients/service-discovery";
import type { ForecastRecord } from "./forecast.types";

async function readForecastErrorMessage(response: Response): Promise<string> {
  const payload = await readJsonBody<Record<string, unknown>>(response);
  return extractErrorMessage(payload, "ForecastBill microservice returned an error");
}

export async function getForecast(uid: string): Promise<ForecastRecord> {
  const response = await fetchService(
    "forecastbill",
    `/api/forecast?uid=${encodeURIComponent(uid)}`,
    {
      timeoutMs: 12000,
    },
  );

  if (!response.ok) {
    throw new Error(await readForecastErrorMessage(response));
  }

  return (await response.json()) as ForecastRecord;
}
