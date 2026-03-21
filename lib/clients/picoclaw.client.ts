export async function generateForecastReasoning(input: {
  baselineKwh: number;
  activeCount: number;
  totalKwh: number;
  pricePerKwh: number;
}) {
  const projectedKwh = Math.max(input.baselineKwh, input.totalKwh * 1.25);
  const projectedCost = Number((projectedKwh * input.pricePerKwh).toFixed(2));

  return {
    projectedKwh,
    projectedCost,
    reasoning:
      "Stub PicoClaw response: projected usage blends baseline profile with recent appliance activity.",
  };
}
