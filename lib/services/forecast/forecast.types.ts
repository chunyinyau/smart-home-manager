import type { RiskLevel } from "@/lib/shared/types";

export interface ForecastBillHistoryEntry {
  billId: number;
  periodCostSgd: number;
  periodKwh: number;
  computedAt: string;
  billingPeriodStart: string;
}

export interface ForecastRecord {
  uid: string;
  userId: number;
  month: string;
  billingPeriodStart?: string;
  generatedAt: string;
  projectedKwh: number;
  projectedCost: number;
  reasoning: string;
  riskLevel: RiskLevel;
  daysToExceed: number | null;
  shortNarrative: string;
  recommendedAppliances?: string[];
  recommendations?: string[];
  model?: Record<string, unknown>;
  billing: {
    currentPeriodHistory?: ForecastBillHistoryEntry[];
    currentPeriodTotalCost?: number;
    currentPeriodTotalKwh?: number;
    daysElapsed?: number;
    daysRemaining?: number;
    sameMonthSpendHistory: ForecastBillHistoryEntry[];
    sameMonthSpendTotal: number;
    sameMonthAverageDailySpend: number;
  };
  budget: {
    budgetCap: number;
    currentCumulativeBill?: number;
    lastMonthCumulativeBill: number;
  };
  profile?: {
    profileId: string;
    hdbType: string;
    baselineMonthlyKwh: number;
    source?: string;
  };
  rate: {
    monthYear: string;
    centsPerKwh: number;
    pricePerKwh: number;
  };
}
