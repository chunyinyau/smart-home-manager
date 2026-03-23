import { DEMO_UID } from "@/lib/shared/constants";
import type { BudgetRecord } from "./budget.types";

const budgetByUser = new Map<string, BudgetRecord>([
  [
    DEMO_UID,
    {
      uid: DEMO_UID,
      monthlyCap: 150,
      currentSpend: 88,
      forecastSpend: 118,
      riskLevel: "HIGH",
      updatedAt: new Date().toISOString(),
    },
  ],
]);

export function getBudget(uid: string) {
  return budgetByUser.get(uid) ?? null;
}

export function saveBudget(budget: BudgetRecord) {
  const nextBudget = {
    ...budget,
    updatedAt: new Date().toISOString(),
  };
  budgetByUser.set(budget.uid, nextBudget);
  return nextBudget;
}
