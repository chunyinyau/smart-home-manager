import type { RiskLevel } from "@/lib/shared/types";

export interface BudgetRecord {
  uid: string;
  monthlyCap: number;
  currentSpend: number;
  forecastSpend: number;
  riskLevel: RiskLevel;
  updatedAt: string;
}
