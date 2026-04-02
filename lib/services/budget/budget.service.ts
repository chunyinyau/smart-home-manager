import { DEMO_UID } from "@/lib/shared/constants";
import type { RiskLevel } from "@/lib/shared/types";
import { getBudget as getBudgetFromRepo, saveBudget } from "./budget.repo";

function normalizeUid(uid: string | number | null | undefined): string {
  if (typeof uid === "string" && uid.trim().length > 0) {
    return uid;
  }
  if (typeof uid === "number" && Number.isFinite(uid)) {
    return String(uid);
  }
  return DEMO_UID;
}

function computeRiskLevel(monthlyCap: number, forecastSpend: number): RiskLevel {
  if (forecastSpend >= monthlyCap) {
    return "CRITICAL";
  }
  if (forecastSpend >= monthlyCap * 0.85) {
    return "HIGH";
  }
  return "SAFE";
}

export function getBudgetStatus(uid: string) {
  return getBudgetFromRepo(normalizeUid(uid));
}

export function updateMonthlyCap(uid: string, monthlyCap: number) {
  const budget = getBudgetFromRepo(normalizeUid(uid));
  if (!budget) {
    return null;
  }

  return saveBudget({
    ...budget,
    monthlyCap,
    riskLevel: computeRiskLevel(monthlyCap, budget.forecastSpend),
  });
}

export function syncBudgetForecast(uid: string, forecastSpend: number) {
  const budget = getBudgetFromRepo(normalizeUid(uid));
  if (!budget) {
    return null;
  }

  return saveBudget({
    ...budget,
    forecastSpend,
    riskLevel: computeRiskLevel(budget.monthlyCap, forecastSpend),
  });
}

export function updateCumulativeBill(uid: string, newTotal: number) {
  const budget = getBudgetFromRepo(normalizeUid(uid));
  if (!budget) {
    return null;
  }

  return saveBudget({
    ...budget,
    currentSpend: newTotal,
  });
}

export const BudgetService = {
  async getBudget(userId: number | string) {
    return getBudgetStatus(normalizeUid(userId));
  },

  async updateMonthlyCap(userId: number | string, budgetCap: number) {
    return updateMonthlyCap(normalizeUid(userId), budgetCap);
  },

  async updateCumulativeBill(userId: number | string, newTotal: number) {
    return updateCumulativeBill(normalizeUid(userId), newTotal);
  },
};