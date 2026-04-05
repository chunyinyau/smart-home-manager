import {
  extractErrorMessage,
  fetchService,
  readJsonBody,
} from "@/lib/clients/service-discovery";
import type { ForecastRecord } from "./forecast.types";

export interface ForecastRecommendation {
  uid: string;
  userId: number;
  generatedAt: string;
  currentRiskLevel: "SAFE" | "HIGH" | "CRITICAL";
  predictedRiskLevel: "SAFE" | "HIGH" | "CRITICAL";
  currentProjectedCost: number;
  projectedCostAfterPlan: number;
  estimatedTotalSavingsSgd: number;
  recommendedDurationMinutes: number;
  recommendations: Array<{
    applianceId?: string;
    name?: string;
    currentWatts?: number;
    priority?: number;
    suggestedDurationMinutes?: number;
    estimatedSavingsSgd?: number;
  }>;
  aiHints?: string[];
  strategy?: string;
}

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

export async function getForecastRecommendation(uid: string): Promise<ForecastRecommendation> {
  const response = await fetchService(
    "forecastbill",
    `/api/forecast/recommendation?uid=${encodeURIComponent(uid)}`,
    {
      timeoutMs: 12000,
    },
  );

  if (!response.ok) {
    throw new Error(await readForecastErrorMessage(response));
  }

  return (await response.json()) as ForecastRecommendation;
}
