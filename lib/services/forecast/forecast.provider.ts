import {
  generateForecastReasoning,
  type PicoClawForecastInput,
} from "@/lib/clients/picoclaw.client";

export async function getForecastPrediction(input: PicoClawForecastInput) {
  return generateForecastReasoning(input);
}
