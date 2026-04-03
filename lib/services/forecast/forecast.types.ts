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
  generatedAt: string;
  projectedKwh: number;
  projectedCost: number;
  reasoning: string;
  riskLevel: RiskLevel;
  daysToExceed: number | null;
  shortNarrative: string;
  billing: {
    sameMonthSpendHistory: ForecastBillHistoryEntry[];
    sameMonthSpendTotal: number;
    sameMonthAverageDailySpend: number;
  };
  budget: {
    budgetCap: number;
    lastMonthCumulativeBill: number;
  };
  rate: {
    monthYear: string;
    centsPerKwh: number;
    pricePerKwh: number;
  };
}
