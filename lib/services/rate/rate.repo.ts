import type { RateRecord } from "./rate.types";

let currentRate: RateRecord = {
  id: "rate_standard",
  pricePerKwh: 0.31,
  tariffType: "standard",
  effectiveFrom: new Date().toISOString(),
  effectiveTo: null,
};

export function getCurrentRate() {
  return currentRate;
}

export function saveCurrentRate(rate: RateRecord) {
  currentRate = rate;
  return currentRate;
}
