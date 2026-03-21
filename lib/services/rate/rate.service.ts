import { getCurrentRate, saveCurrentRate } from "./rate.repo";

export function getRate() {
  return getCurrentRate();
}

export function updateRate(pricePerKwh: number) {
  const current = getCurrentRate();
  return saveCurrentRate({
    ...current,
    pricePerKwh,
    effectiveFrom: new Date().toISOString(),
  });
}
