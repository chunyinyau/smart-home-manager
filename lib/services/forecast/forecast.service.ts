import { getUsageSummary } from "@/lib/services/appliance/appliance.service";
import { syncBudgetForecast } from "@/lib/services/budget/budget.service";
import { logHistory } from "@/lib/services/history/history.service";
import { getUserProfile } from "@/lib/services/profile/profile.service";
import { getRate } from "@/lib/services/rate/rate.service";
import { getForecastPrediction } from "./forecast.provider";
import type { ForecastRecord } from "./forecast.types";

export async function getForecast(uid: string): Promise<ForecastRecord | null> {
  const profile = getUserProfile(uid);
  if (!profile) {
    return null;
  }

  const usage = await getUsageSummary(uid);
  const rate = await getRate();
  const prediction = await getForecastPrediction({
    baselineKwh: profile.baselineKwh,
    activeCount: usage.activeCount,
    totalKwh: usage.totalKwh,
    pricePerKwh: rate.pricePerKwh,
  });

  syncBudgetForecast(uid, prediction.projectedCost);
  logHistory(uid, "FORECAST_GENERATED", "forecast_service", prediction.reasoning);

  return {
    uid,
    projectedKwh: Number(prediction.projectedKwh.toFixed(1)),
    projectedCost: prediction.projectedCost,
    reasoning: prediction.reasoning,
    generatedAt: new Date().toISOString(),
  };
}
