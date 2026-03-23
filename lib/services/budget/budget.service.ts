import { getBudget, saveBudget } from "./budget.repo";
import type { BudgetRecord } from "./budget.types";

function deriveRiskLevel(forecastSpend: number, monthlyCap: number): BudgetRecord["riskLevel"] {
  const ratio = forecastSpend / monthlyCap;
  if (ratio >= 1) {
    return "CRITICAL";
  }
  if (ratio >= 0.8) {
    return "HIGH";
  }
  return "SAFE";
}

export function getBudgetStatus(uid: string) {
  return getBudget(uid);
}

export function updateMonthlyCap(uid: string, monthlyCap: number) {
  const existingBudget = getBudget(uid);
  if (!existingBudget) {
    return null;
  }

  return saveBudget({
    ...existingBudget,
    monthlyCap,
    riskLevel: deriveRiskLevel(existingBudget.forecastSpend, monthlyCap),
  });
}

export function syncBudgetForecast(uid: string, forecastSpend: number) {
  const existingBudget = getBudget(uid);
  if (!existingBudget) {
    return null;
  }

  return saveBudget({
    ...existingBudget,
    forecastSpend,
    riskLevel: deriveRiskLevel(forecastSpend, existingBudget.monthlyCap),
  });
}
