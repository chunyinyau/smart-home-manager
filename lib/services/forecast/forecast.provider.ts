import { generateForecastReasoning } from "@/lib/clients/picoclaw.client";

export async function getForecastPrediction(input: {
  baselineKwh: number;
  activeCount: number;
  totalKwh: number;
  pricePerKwh: number;
}) {
  return generateForecastReasoning(input);
}
