export interface ApplianceRecord {
  id: string;
  uid: string;
  name: string;
  room: string;
  type: string;
  state: "ON" | "OFF";
  priority: number;
  currentWatts: number;
  kwhUsed: number;
  lastSeenAt: string;
}

export interface BudgetData {
  budget_id: number;
  user_id: number;
  budget_cap: number;
  cum_bill: number;
}

export interface ForecastBillHistoryEntry {
  billId: number;
  periodCostSgd: number;
  periodKwh: number;
  computedAt: string;
  billingPeriodStart: string;
}

export interface ForecastData {
  uid: string;
  userId: number;
  month: string;
  billingPeriodStart?: string;
  generatedAt: string;
  projectedKwh: number;
  projectedCost: number;
  reasoning: string;
  riskLevel: "SAFE" | "HIGH" | "CRITICAL";
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

export interface HistoryLog {
  log_id: number;
  user_id: string;
  message: string;
  occurred_at: string;
}

export interface BillRecord {
  bill_id: number;
  user_id: number;
  period_cost_sgd: number;
  period_kwh: number;
  computed_at: string;
  billing_period_start: string;
}

export interface ProfileData {
  profile_id: number;
  user_id: number;
  hdb_type: number;
  baseline_monthly_kwh: number;
  name?: string;
  email?: string;
}

export interface DisplayPayload {
  uid: string;
  profile_id: string;
  fetched_at: string;
  budget: BudgetData | null;
  forecast: ForecastData | null;
  history: HistoryLog[] | null;
  bills: BillRecord[] | null;
  appliances: ApplianceRecord[] | null;
  profile: ProfileData | null;
  _errors?: Record<string, string>;
}
