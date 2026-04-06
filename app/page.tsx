"use client";

import React, { useState, useEffect } from 'react';
import {
  Search, LayoutDashboard, Server, Database, Wallet,
  Activity, Layers, Wrench, ShieldCheck, Settings,
  MessageSquare, Sun, Moon, Book, ChevronDown,
  ChevronRight, Zap
} from 'lucide-react';
import SpatialEnergyPanel from '@/components/SpatialEnergyPanel';

import { DisplayPayload } from '@/lib/types/display.types';
import { DEMO_UID } from '@/lib/shared/constants';

type CalculateBillRunPayload = {
  success?: boolean;
  error?: string;
  data?: {
    computed_at?: string;
    result?: {
      period_kwh?: number;
      period_cost_sgd?: number;
      monthly_total_sgd?: number;
    };
    month_close?: {
      closed?: boolean;
      reason?: string;
    };
  };
};

type CalculateBillStatePayload = {
  success?: boolean;
  error?: string;
  data?: Record<
    string,
    {
      month?: string;
      running_total?: number;
      updated_at?: string;
      closed_month?: string | null;
    }
  >;
};

type ForecastRecommendationPayload = {
  currentRiskLevel?: "SAFE" | "HIGH" | "CRITICAL";
  predictedRiskLevel?: "SAFE" | "HIGH" | "CRITICAL";
  currentProjectedCost?: number;
  recommendedDurationMinutes?: number;
  target?: {
    requiredSavingsForSafeSgd?: number;
    remainingSavingsForSafeSgd?: number;
    requiredSavingsForSafetyNetSgd?: number;
    remainingSavingsForSafetyNetSgd?: number;
    safeThresholdRatio?: number;
    safeMinimumBudgetCap?: number;
    targetSafetyThresholdRatio?: number;
    met?: boolean;
    metSafetyNet?: boolean;
    feasibilityStatus?: 'achievable' | 'stretch' | 'not_achievable';
    feasibilityGapSgd?: number;
    maxPotentialSavingsSgd?: number;
    conservativePotentialSavingsSgd?: number;
    easyPotentialSavingsSgd?: number;
    feasibleMinBudgetCap?: number;
    nearestFeasibleBudgetCap?: number;
    recommendedBudgetCapRange?: {
      low?: number;
      high?: number;
    };
  };
  recommendations?: Array<{
    applianceId?: string;
    name?: string;
    suggestedDurationMinutes?: number;
    estimatedSavingsSgd?: number;
  }>;
};

type RecommendedActionItem = {
  applianceId: string;
  name: string;
  durationMinutes: number;
  estimatedSavingsSgd?: number;
};

type ReactivationItem = {
  applianceId: string;
  name: string;
  until?: string | null;
};

type OptionBApplyPayload = {
  success?: boolean;
  message?: string;
  error?: string;
  budget?: {
    budgetCap?: number;
    rolledBack?: boolean;
  };
  safeguard?: {
    applied?: boolean;
    reason?: string;
    stabilizedCap?: number;
    maxBudgetCap?: number | null;
    rolledBack?: boolean;
  };
  actions?: {
    requestedCount?: number;
    appliedCount?: number;
    failedCount?: number;
  };
};

const OPTION_B_MIN_CAP_DELTA_SGD = 0.5;
const OPTION_B_MIN_ACTION_SAVINGS_SGD = 0.25;
const OPTION_B_MIN_TOTAL_SAVINGS_SGD = 0.5;

function formatUtcTimestamp(value: string | null | undefined): string {
  if (!value) {
    return 'N/A';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Invalid timestamp';
  }

  const sgt = new Date(parsed.getTime() + 8 * 60 * 60 * 1000);
  const year = sgt.getUTCFullYear();
  const month = String(sgt.getUTCMonth() + 1).padStart(2, '0');
  const day = String(sgt.getUTCDate()).padStart(2, '0');
  const hour = String(sgt.getUTCHours()).padStart(2, '0');
  const minute = String(sgt.getUTCMinutes()).padStart(2, '0');
  const second = String(sgt.getUTCSeconds()).padStart(2, '0');

  return `${year}-${month}-${day} ${hour}:${minute}:${second} SGT`;
}

export default function App() {
  const [currentRate, setCurrentRate] = useState<number | null>(null);
  const [data, setData] = useState<DisplayPayload | null>(null);
  const [accruedSpendFallback, setAccruedSpendFallback] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [runningBillCycle, setRunningBillCycle] = useState(false);
  const [billRunResult, setBillRunResult] = useState<CalculateBillRunPayload | null>(null);
  const [billRunError, setBillRunError] = useState<string | null>(null);
  const [dataMenuOpen, setDataMenuOpen] = useState(false);
  const [suggestedActionsOpen, setSuggestedActionsOpen] = useState(true);
  const [cronState, setCronState] = useState<CalculateBillStatePayload["data"] | null>(null);
  const [cronStateLoading, setCronStateLoading] = useState(true);
  const [cronStateError, setCronStateError] = useState<string | null>(null);
  const [budgetMenuOpen, setBudgetMenuOpen] = useState(false);
  const [automationMenuOpen, setAutomationMenuOpen] = useState(false);
  const [budgetCapInput, setBudgetCapInput] = useState<string>('');
  const [updatingBudget, setUpdatingBudget] = useState(false);
  const [budgetActionFeedback, setBudgetActionFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [automatingState, setAutomatingState] = useState(false);
  const [automationFeedback, setAutomationFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [applianceMenuOpen, setApplianceMenuOpen] = useState(false);
  const [togglingApplianceId, setTogglingApplianceId] = useState<string | null>(null);
  const [forecastRecommendation, setForecastRecommendation] = useState<ForecastRecommendationPayload | null>(null);
  const [applyingActionId, setApplyingActionId] = useState<string | null>(null);
  const [applyingAllActions, setApplyingAllActions] = useState(false);
  const [applyingOptionA, setApplyingOptionA] = useState(false);
  const [applyingOptionB, setApplyingOptionB] = useState(false);
  const [optionBModeActive, setOptionBModeActive] = useState(false);
  const [restoringActionId, setRestoringActionId] = useState<string | null>(null);
  const [restoringAllActions, setRestoringAllActions] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [liveForecastNarrative, setLiveForecastNarrative] = useState<string | null>(null);

  const fetchDashboardData = async (isManual = false) => {
    try {
      const [rateResponse, displayResponse, recommendationResponse, forecastResponse] = await Promise.all([
        fetch('/api/rate', { cache: 'no-store' }),
        fetch(`/api/display?uid=${DEMO_UID}&profile_id=1`, { cache: 'no-store' }),
        fetch(`/api/forecast/recommendation?uid=${DEMO_UID}`, { cache: 'no-store' }),
        fetch(`/api/forecast?uid=${DEMO_UID}`, { cache: 'no-store' }),
      ]);

      const ratePayload = await rateResponse.json();
      if (ratePayload.success && ratePayload.data) {
        const rateData = Array.isArray(ratePayload.data) ? ratePayload.data[0] : ratePayload.data;
        setCurrentRate(rateData?.cents_per_kwh || null);
      }

      const displayPayload = await displayResponse.json();
      let finalDisplayPayload = displayPayload;

      if (forecastResponse.ok) {
        const forecastPayload = await forecastResponse.json();
        if (typeof forecastPayload?.shortNarrative === 'string' && forecastPayload.shortNarrative.trim().length > 0) {
          setLiveForecastNarrative(forecastPayload.shortNarrative.trim());
        }
        finalDisplayPayload = {
          ...displayPayload,
          forecast: forecastPayload,
        };
      } else {
        setLiveForecastNarrative(null);
      }

      setData(finalDisplayPayload);

      if (recommendationResponse.ok) {
        const recommendationPayload = (await recommendationResponse.json()) as ForecastRecommendationPayload;
        setForecastRecommendation(recommendationPayload);
      } else {
        setForecastRecommendation(null);
      }

      // If persisted budget is still zero after restart, show immediate CSV-derived accrual.
      const budgetCumBill = Number(finalDisplayPayload?.budget?.cum_bill ?? 0);
      if (budgetCumBill <= 0 && ratePayload?.data) {
        const accrualResponse = await fetch('/api/appliance/telemetry/accrual', {
          cache: 'no-store',
        });
        if (accrualResponse.ok) {
          const accrualPayload = await accrualResponse.json();
          const accruedKwh = Number(accrualPayload?.accruedSliceKwh ?? 0);
          const centsPerKwh = Number(
            (Array.isArray(ratePayload.data) ? ratePayload.data[0] : ratePayload.data)?.cents_per_kwh ?? 0,
          );
          if (Number.isFinite(accruedKwh) && Number.isFinite(centsPerKwh)) {
            const estimatedSpend = accruedKwh * (centsPerKwh / 100);
            setAccruedSpendFallback(Number(estimatedSpend.toFixed(4)));
          }
        }
      } else {
        setAccruedSpendFallback(null);
      }
      return rateResponse.ok && displayResponse.ok;
    } catch (err) {
      console.error("Failed to fetch dashboard data", err);
      return false;
    } finally {
      if (!isManual) setLoading(false);
    }
  };

  useEffect(() => {
    let alive = true;
    let timeoutId: number | null = null;

    const runPoll = async () => {
      const success = await fetchDashboardData();
      if (alive) {
        const nextDelayMs = success ? 60000 : 5000;
        timeoutId = window.setTimeout(runPoll, nextDelayMs);
      }
    };

    runPoll();

    return () => {
      alive = false;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, []);

  useEffect(() => {
    let alive = true;
    let timeoutId: number | null = null;

    const fetchCronState = async () => {
      let success = false;
      try {
        const response = await fetch('/api/calculatebill/state', {
          cache: 'no-store',
        });
        const payload = (await response.json()) as CalculateBillStatePayload;

        if (!response.ok || payload.success === false) {
          throw new Error(payload.error || `HTTP ${response.status}`);
        }

        if (!alive) {
          return;
        }

        const stateData = payload.data ?? {};
        setCronState(stateData);
        setCronStateError(null);
        success = Object.keys(stateData).length > 0;
      } catch (error) {
        if (!alive) {
          return;
        }
        const message = error instanceof Error ? error.message : 'Unknown error';
        setCronStateError(message);
      } finally {
        if (alive) {
          setCronStateLoading(false);
          const nextDelayMs = success ? 60000 : 5000;
          timeoutId = window.setTimeout(fetchCronState, nextDelayMs);
        }
      }
    };

    fetchCronState();

    return () => {
      alive = false;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, []);

  const runCalculateBill = async () => {
    setRunningBillCycle(true);
    setBillRunError(null);
    setBillRunResult(null);

    try {
      const response = await fetch('/api/calculatebill/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: 1,
          uid: DEMO_UID,
          interval_minutes: 5,
          sync_budget: true,
        }),
      });

      const payload = (await response.json()) as CalculateBillRunPayload;
      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }

      setBillRunResult(payload);
      await fetchDashboardData(true);

      const cronResponse = await fetch('/api/calculatebill/state', { cache: 'no-store' });
      if (cronResponse.ok) {
        const cronPayload = (await cronResponse.json()) as CalculateBillStatePayload;
        const stateData = cronPayload.data ?? {};
        setCronState(stateData);
        setCronStateError(null);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setBillRunError(message);
    } finally {
      setRunningBillCycle(false);
    }
  };

  const handleUpdateBudget = async () => {
    const parsedMonthlyCap = Number.parseFloat(budgetCapInput);
    if (!Number.isFinite(parsedMonthlyCap) || parsedMonthlyCap < 0) {
      setBudgetActionFeedback({ type: 'error', message: 'Enter a valid amount (0 or above).' });
      return;
    }

    const monthlyCap = Number(parsedMonthlyCap.toFixed(2));

    setUpdatingBudget(true);
    setBudgetActionFeedback(null);
    try {
      const response = await fetch('/api/orchestrator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intent: 'set_budget',
          params: { uid: DEMO_UID, monthlyCap }
        }),
      });
      const result = await response.json();
      if (!response.ok || (result.accepted === false)) {
        setBudgetActionFeedback({ type: 'error', message: result.message || result.error || 'Failed to update budget' });
      } else {
        setBudgetActionFeedback({ type: 'success', message: `Budget cap updated to $${monthlyCap.toFixed(2)}.` });
        setBudgetCapInput(monthlyCap.toFixed(2));
        await fetchDashboardData(true);
        // Force refresh or update local state
        setTimeout(() => setBudgetMenuOpen(false), 2000);
      }
    } catch (err) {
      setBudgetActionFeedback({ type: 'error', message: 'Network error occurred' });
    } finally {
      setUpdatingBudget(false);
    }
  };

  useEffect(() => {
    if (updatingBudget || budgetMenuOpen) {
      return;
    }

    const latestBudgetCap = Number(data?.budget?.budget_cap ?? NaN);
    if (Number.isFinite(latestBudgetCap) && latestBudgetCap >= 0) {
      setBudgetCapInput(latestBudgetCap.toFixed(2));
    }
  }, [data?.budget?.budget_cap, updatingBudget, budgetMenuOpen]);

  const handleAutoShutdown = async () => {
    setAutomatingState(true);
    setAutomationFeedback(null);
    try {
      const response = await fetch('/api/request-change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: DEMO_UID, targetState: 'OFF' }),
      });
      const result = await response.json();
      if (!response.ok || result.error) {
        setAutomationFeedback({ type: 'error', message: result.error || 'Automation failed' });
      } else {
        setAutomationFeedback({ type: 'success', message: result.message || 'Shut down heaviest load' });
        setTimeout(() => setAutomationMenuOpen(false), 2000);
      }
    } catch (err) {
      setAutomationFeedback({ type: 'error', message: 'Network error occurred' });
    } finally {
      setAutomatingState(false);
    }
  };

  const handleToggleAppliance = async (aid: string, currentState: string) => {
    const targetState = currentState.toUpperCase() === 'ON' ? 'OFF' : 'ON';
    setTogglingApplianceId(aid);

    // Optimistic UI update: instantly update local state
    if (data?.appliances) {
      const updatedAppliances = data.appliances.map(app => 
        app.id === aid ? { ...app, state: targetState as "OFF" | "ON" } : app
      );
      setData({ ...data, appliances: updatedAppliances });
    }

    try {
      const response = await fetch('/api/request-change', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          uid: DEMO_UID,
          aid: aid,
          targetState: targetState,
        }),
      });

      if (response.ok) {
        // Final sync to ensure everything is matched with backend
        await fetchDashboardData(true);
      } else {
        // Revert on failure
        await fetchDashboardData(true);
      }
    } catch (err) {
      console.error("Toggle appliance failure:", err);
      // Revert on error
      await fetchDashboardData(true);
    } finally {
      setTogglingApplianceId(null);
    }
  };

  const handleApplySuggestedAction = async (action: RecommendedActionItem) => {
    if (
      applyingOptionA ||
      applyingOptionB ||
      applyingAllActions ||
      restoringAllActions ||
      restoringActionId !== null
    ) {
      return;
    }

    setApplyingActionId(action.applianceId);
    setActionFeedback(null);

    try {
      const response = await fetch('/api/request-change', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          uid: DEMO_UID,
          aid: action.applianceId,
          targetState: 'OFF',
          durationMinutes: action.durationMinutes,
        }),
      });

      const payload = await response.json();
      if (!response.ok || payload?.error) {
        throw new Error(payload?.error || `HTTP ${response.status}`);
      }

      setActionFeedback({
        type: 'success',
        message: `${action.name} set OFF for ${action.durationMinutes} min.`,
      });
      await fetchDashboardData(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to apply action';
      setActionFeedback({ type: 'error', message });
    } finally {
      setApplyingActionId(null);
    }
  };

  const handleApplyAllSuggestedActions = async (actions: RecommendedActionItem[]) => {
    if (actions.length === 0) {
      return;
    }

    if (restoringAllActions || restoringActionId !== null) {
      return;
    }

    if (applyingOptionA || applyingOptionB) {
      return;
    }

    setApplyingAllActions(true);
    setApplyingActionId(null);
    setActionFeedback(null);

    const uniqueActions = Array.from(
      new Map(actions.map((item) => [item.applianceId, item])).values(),
    );

    const appliedNames: string[] = [];

    try {
      for (const action of uniqueActions) {
        const response = await fetch('/api/request-change', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            uid: DEMO_UID,
            aid: action.applianceId,
            targetState: 'OFF',
            durationMinutes: action.durationMinutes,
          }),
        });

        const payload = await response.json();
        if (!response.ok || payload?.error) {
          throw new Error(payload?.error || `HTTP ${response.status}`);
        }

        appliedNames.push(action.name);
      }

      await fetchDashboardData(true);
      setActionFeedback({
        type: 'success',
        message: `Applied OFF action for ${appliedNames.join(', ')}.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to apply all actions';
      setActionFeedback({ type: 'error', message });
    } finally {
      setApplyingAllActions(false);
    }
  };

  const handleApplyOptionAPlan = async () => {
    if (
      applyingOptionA ||
      applyingOptionB ||
      applyingAllActions ||
      applyingActionId !== null ||
      restoringAllActions ||
      restoringActionId !== null
    ) {
      return;
    }

    const resolvedBudgetCap = optionABudgetCap;
    if (!Number.isFinite(resolvedBudgetCap) || resolvedBudgetCap <= 0) {
      setActionFeedback({ type: 'error', message: 'Option A safe minimum budget cap is unavailable.' });
      return;
    }

    setApplyingOptionA(true);
    setActionFeedback(null);
    setBudgetActionFeedback(null);

    try {
      const response = await fetch('/api/forecast/option-a', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          uid: DEMO_UID,
          userId: Number(data?.budget?.user_id ?? 1),
          budgetCap: Number(resolvedBudgetCap.toFixed(2)),
          restoreOverrides: hasActiveOffOverrides,
        }),
      });

      const payload = (await response.json()) as OptionBApplyPayload;
      if (!response.ok || payload.success === false) {
        throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
      }

      const persistedCap = Number(payload.budget?.budgetCap ?? resolvedBudgetCap);
      const restoredCount = Number((payload as { restoredOverrides?: { restoredCount?: number } }).restoredOverrides?.restoredCount ?? 0);

      setBudgetActionFeedback({
        type: 'success',
        message: `Option A saved budget cap at $${persistedCap.toFixed(2)}.`,
      });
      setActionFeedback({
        type: 'success',
        message: restoredCount > 0
          ? `Option A applied. Restored ${restoredCount} appliance override(s) and recalculated baseline budget.`
          : 'Option A applied. SAFE minimum budget cap is now persisted.',
      });

      setData((prev) => {
        if (!prev?.budget) {
          return prev;
        }
        return {
          ...prev,
          budget: {
            ...prev.budget,
            budget_cap: persistedCap,
          },
        };
      });
      void fetchDashboardData(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to apply Option A plan';
      setActionFeedback({ type: 'error', message });
    } finally {
      setApplyingOptionA(false);
    }
  };

  const handleApplyOptionBPlan = async () => {
    if (
      applyingOptionA ||
      applyingOptionB ||
      applyingAllActions ||
      applyingActionId !== null ||
      restoringAllActions ||
      restoringActionId !== null
    ) {
      return;
    }

    const resolvedBudgetCap = optionBBudgetCap;
    if (!Number.isFinite(resolvedBudgetCap) || resolvedBudgetCap <= 0) {
      setActionFeedback({ type: 'error', message: 'Option B budget cap is unavailable.' });
      return;
    }

    if (optionBActions.length === 0) {
      setActionFeedback({ type: 'error', message: 'No meaningful mitigation actions available for Option B.' });
      return;
    }

    if (plannedMitigationSavings < OPTION_B_MIN_TOTAL_SAVINGS_SGD) {
      setActionFeedback({ type: 'error', message: `Option B needs at least $${OPTION_B_MIN_TOTAL_SAVINGS_SGD.toFixed(2)} estimated savings.` });
      return;
    }

    if (optionABudgetCap > 0 && resolvedBudgetCap >= optionABudgetCap) {
      setActionFeedback({ type: 'error', message: 'Option B cap must stay below Option A.' });
      return;
    }

    setApplyingOptionB(true);
    setActionFeedback(null);
    setBudgetActionFeedback(null);

    try {
      const response = await fetch('/api/forecast/option-b', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          uid: DEMO_UID,
          userId: Number(data?.budget?.user_id ?? 1),
          budgetCap: Number(resolvedBudgetCap.toFixed(2)),
          maxBudgetCap:
            optionABudgetCap > 0
              ? Number(Math.max(optionABudgetCap - OPTION_B_MIN_CAP_DELTA_SGD, 0.01).toFixed(2))
              : undefined,
          actions: optionBActions.map((item) => ({
            applianceId: item.applianceId,
            name: item.name,
            durationMinutes: item.durationMinutes,
          })),
        }),
      });

      const payload = (await response.json()) as OptionBApplyPayload;
      if (!response.ok || payload.success === false) {
        throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
      }

      const appliedCount = Number(payload.actions?.appliedCount ?? 0);
      const failedCount = Number(payload.actions?.failedCount ?? 0);
      const persistedCap = Number(payload.budget?.budgetCap ?? resolvedBudgetCap);

      setBudgetActionFeedback({
        type: 'success',
        message: `Option B saved budget cap at $${persistedCap.toFixed(2)}.`,
      });

      if (failedCount > 0) {
        setActionFeedback({
          type: 'error',
          message: `Option B partially applied: ${appliedCount} action(s) applied, ${failedCount} failed.`,
        });
      } else {
        setActionFeedback({
          type: 'success',
          message: `Option B applied successfully with ${appliedCount} mitigation action(s).`,
        });
      }
      setOptionBModeActive(true);

      setData((prev) => {
        if (!prev?.budget) {
          return prev;
        }
        return {
          ...prev,
          budget: {
            ...prev.budget,
            budget_cap: persistedCap,
          },
        };
      });
      void fetchDashboardData(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to apply Option B plan';
      setActionFeedback({ type: 'error', message });
    } finally {
      setApplyingOptionB(false);
    }
  };

  const handleTurnOnAppliance = async (item: ReactivationItem) => {
    if (
      applyingOptionA ||
      applyingOptionB ||
      applyingAllActions ||
      restoringAllActions ||
      applyingActionId !== null
    ) {
      return;
    }

    setRestoringActionId(item.applianceId);
    setActionFeedback(null);

    try {
      const response = await fetch('/api/request-change', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          uid: DEMO_UID,
          aid: item.applianceId,
          targetState: 'ON',
        }),
      });

      const payload = await response.json();
      if (!response.ok || payload?.error) {
        throw new Error(payload?.error || `HTTP ${response.status}`);
      }

      await fetchDashboardData(true);
      setActionFeedback({
        type: 'success',
        message: `${item.name} turned back ON.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to turn appliance ON';
      setActionFeedback({ type: 'error', message });
    } finally {
      setRestoringActionId(null);
    }
  };

  const handleTurnOnAllAppliances = async (items: ReactivationItem[]) => {
    if (items.length === 0) {
      return;
    }

    if (applyingOptionA || applyingOptionB || applyingAllActions || applyingActionId !== null) {
      return;
    }

    setRestoringAllActions(true);
    setRestoringActionId(null);
    setActionFeedback(null);

    const uniqueItems = Array.from(
      new Map(items.map((item) => [item.applianceId, item])).values(),
    );

    const restoredNames: string[] = [];

    try {
      for (const item of uniqueItems) {
        const response = await fetch('/api/request-change', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            uid: DEMO_UID,
            aid: item.applianceId,
            targetState: 'ON',
          }),
        });

        const payload = await response.json();
        if (!response.ok || payload?.error) {
          throw new Error(payload?.error || `HTTP ${response.status}`);
        }

        restoredNames.push(item.name);
      }

      await fetchDashboardData(true);
      setOptionBModeActive(false);
      window.location.reload();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to turn appliances ON';
      setActionFeedback({ type: 'error', message });
    } finally {
      setRestoringAllActions(false);
    }
  };

  const budget = data?.budget;
  const forecast = data?.forecast;
  const recommendationParagraph =
    (typeof liveForecastNarrative === 'string' && liveForecastNarrative.trim().length > 0
      ? liveForecastNarrative.trim()
      : typeof forecast?.shortNarrative === 'string'
        ? forecast.shortNarrative.trim()
        : '') ||
    'AI recommendation is updating...';
  const fallbackMonth = (() => {
    const now = new Date();
    const sgt = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const year = sgt.getUTCFullYear();
    const month = String(sgt.getUTCMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  })();
  const cronUserState = cronState?.["1"];
  const displayedAccruedSpend = (() => {
    const cronRunningTotal = Number(cronUserState?.running_total ?? NaN);
    if (Number.isFinite(cronRunningTotal) && cronRunningTotal >= 0) {
      return cronRunningTotal;
    }

    const persisted = Number(budget?.cum_bill ?? 0);
    if (persisted > 0) {
      return persisted;
    }
    return accruedSpendFallback ?? 0;
  })();
  const profile = data?.profile;
  const history = data?.history || [];
  const budgetStatusValue = forecast?.riskLevel ?? '---';
  const budgetStatusColor =
    !forecast ? 'text-gray-400' :
    forecast.riskLevel === 'CRITICAL' ? 'text-rose-600' :
    forecast.riskLevel === 'HIGH' ? 'text-amber-500' :
    'text-emerald-600';
  const isActionableRisk = forecast?.riskLevel === 'HIGH' || forecast?.riskLevel === 'CRITICAL';
  const suggestedAppliances = Array.from(
    new Set(
      (isActionableRisk
        ? [
            ...(Array.isArray(forecast?.recommendedAppliances) ? forecast.recommendedAppliances : []),
            ...(Array.isArray(forecast?.recommendations) ? forecast.recommendations : []),
          ]
        : [])
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter((item) => item.length > 0),
    ),
  );
  const suggestedActionItems =
    (isActionableRisk ? forecastRecommendation?.recommendations : [])
      ?.map((item) => {
        const name = (item.name || 'Appliance').trim();
        const defaultDuration = forecastRecommendation?.recommendedDurationMinutes ?? 0;
        const duration = Number(item.suggestedDurationMinutes ?? defaultDuration);
        if (!Number.isFinite(duration) || duration <= 0) {
          return `${name}: OFF`;
        }
        return `${name}: OFF ${Math.round(duration)} min`;
      })
      .filter((item) => item.length > 0) ?? [];
  const recommendedActionItems: RecommendedActionItem[] =
    (isActionableRisk ? forecastRecommendation?.recommendations : [])
      ?.map((item): RecommendedActionItem | null => {
        const applianceId = typeof item.applianceId === 'string' ? item.applianceId : '';
        const name = (item.name || 'Appliance').trim();
        const defaultDuration = forecastRecommendation?.recommendedDurationMinutes ?? 0;
        const duration = Number(item.suggestedDurationMinutes ?? defaultDuration);

        if (!applianceId || !Number.isFinite(duration) || duration <= 0) {
          return null;
        }

        const action: RecommendedActionItem = {
          applianceId,
          name,
          durationMinutes: Math.round(duration),
        };

        if (typeof item.estimatedSavingsSgd === 'number') {
          action.estimatedSavingsSgd = item.estimatedSavingsSgd;
        }

        return action;
      })
      .filter((item): item is RecommendedActionItem => item !== null) ?? [];
  const optionBActions = (() => {
    const ranked = [...recommendedActionItems].sort(
      (a, b) => Number(b.estimatedSavingsSgd ?? 0) - Number(a.estimatedSavingsSgd ?? 0),
    );

    const meaningful = ranked.filter((item) => {
      const estimatedSavings = Number(item.estimatedSavingsSgd ?? 0);
      return estimatedSavings >= OPTION_B_MIN_ACTION_SAVINGS_SGD || item.durationMinutes >= 180;
    });

    if (meaningful.length > 0) {
      return meaningful;
    }

    return ranked
      .slice(0, 1)
      .filter((item) => Number(item.estimatedSavingsSgd ?? 0) > 0);
  })();
  const activeOffOverrideNames =
    (data?.appliances ?? [])
      .filter((appliance) => appliance?.manualOverride?.active && appliance?.state?.toUpperCase() === 'OFF')
      .map((appliance) => appliance.name)
      .filter((name) => Boolean(name)) ?? [];
  const hasActiveOffOverrides = activeOffOverrideNames.length > 0;
  const reactivationItems: ReactivationItem[] =
    (data?.appliances ?? [])
      .filter((appliance) => appliance?.manualOverride?.active && appliance?.state?.toUpperCase() === 'OFF')
      .map((appliance) => ({
        applianceId: appliance.id,
        name: appliance.name,
        until: appliance.manualOverride?.until,
      }));
  const remainingSavingsForSafetyNet = Number(
    forecastRecommendation?.target?.remainingSavingsForSafetyNetSgd ?? 0,
  );
  const safeThresholdRatio = Number(
    forecastRecommendation?.target?.safeThresholdRatio ?? 0.85,
  );
  const safeMinimumBudgetCap = Number(
    forecastRecommendation?.target?.safeMinimumBudgetCap ?? 0,
  );
  const targetSafetyThresholdRatio = 0.8;
  const feasibilityStatus = forecastRecommendation?.target?.feasibilityStatus;
  const feasibilityRangeLow = Number(
    forecastRecommendation?.target?.recommendedBudgetCapRange?.low ?? 0,
  );
  const feasibilityRangeHigh = Number(
    forecastRecommendation?.target?.recommendedBudgetCapRange?.high ?? 0,
  );
  const feasibilityGap = Number(forecastRecommendation?.target?.feasibilityGapSgd ?? 0);
  const nearestFeasibleCap = Number(forecastRecommendation?.target?.nearestFeasibleBudgetCap ?? 0);
  const conservativePotentialSavings = Number(
    forecastRecommendation?.target?.conservativePotentialSavingsSgd ?? 0,
  );
  const maxPotentialSavings = Number(
    forecastRecommendation?.target?.maxPotentialSavingsSgd ?? 0,
  );
  const plannedMitigationSavings = optionBActions.reduce(
    (total, item) => total + Number(item.estimatedSavingsSgd ?? 0),
    0,
  );
  const feasibilityRangeSpan = Math.max(0, feasibilityRangeHigh - feasibilityRangeLow);
  const feasibilityRangeLabel =
    feasibilityRangeLow > 0 || feasibilityRangeHigh > 0
      ? feasibilityRangeSpan < 0.5
        ? `Around $${((feasibilityRangeLow + feasibilityRangeHigh) / 2).toFixed(2)}`
        : `$${feasibilityRangeLow.toFixed(2)} to $${feasibilityRangeHigh.toFixed(2)}`
      : 'Unavailable';
  const optionABudgetCap = (() => {
    const projected = Number(
      forecastRecommendation?.currentProjectedCost ?? forecast?.projectedCost ?? 0,
    );
    const currentCap = Number(budget?.budget_cap ?? 0);

    let baselineCap = 0;
    const bufferedCap =
      Number.isFinite(projected) && projected > 0 && targetSafetyThresholdRatio > 0
        ? Number(((projected + 0.01) / targetSafetyThresholdRatio).toFixed(2))
        : 0;

    if (Number.isFinite(safeMinimumBudgetCap) && safeMinimumBudgetCap > 0) {
      baselineCap = bufferedCap > 0 ? Math.max(safeMinimumBudgetCap, bufferedCap) : safeMinimumBudgetCap;
    }

    if (baselineCap <= 0 && bufferedCap > 0) {
      baselineCap = bufferedCap;
    }

    if (baselineCap <= 0 && Number.isFinite(projected) && projected > 0 && safeThresholdRatio > 0) {
      baselineCap = Number(((projected + 0.01) / safeThresholdRatio).toFixed(2));
    }

    if (activeOffOverrideNames.length > 0 && Number.isFinite(currentCap) && currentCap > 0) {
      baselineCap = Math.max(baselineCap, currentCap + OPTION_B_MIN_CAP_DELTA_SGD);
    }

    return Number(Math.max(0, baselineCap).toFixed(2));
  })();
  const optionBBudgetCap = (() => {
    const optionBTargetRatio =
      Number.isFinite(targetSafetyThresholdRatio) && targetSafetyThresholdRatio > 0
        ? targetSafetyThresholdRatio
        : safeThresholdRatio;

    const normalizeLeanCap = (candidate: number) => {
      if (!Number.isFinite(candidate) || candidate <= 0) {
        return 0;
      }

      const optionAReference = Number(optionABudgetCap);
      if (Number.isFinite(optionAReference) && optionAReference > 0) {
        const lowerThanOptionA = Math.max(optionAReference - OPTION_B_MIN_CAP_DELTA_SGD, 0.01);
        return Number(Math.min(candidate, lowerThanOptionA).toFixed(2));
      }

      return Number(candidate.toFixed(2));
    };

    const projectedCost = Number(forecast?.projectedCost ?? 0);
    const modeledSavings = Math.max(
      plannedMitigationSavings,
      Number.isFinite(conservativePotentialSavings) ? conservativePotentialSavings : 0,
    );
    if (projectedCost > 0 && optionBTargetRatio > 0 && modeledSavings > 0) {
      const leanCapFromMitigation = ((projectedCost - modeledSavings) + 0.01) / optionBTargetRatio;
      if (Number.isFinite(leanCapFromMitigation) && leanCapFromMitigation > 0) {
        return normalizeLeanCap(leanCapFromMitigation);
      }
    }

    if (Number.isFinite(feasibilityRangeLow) && feasibilityRangeLow > 0) {
      return normalizeLeanCap(feasibilityRangeLow);
    }

    if (Number.isFinite(nearestFeasibleCap) && nearestFeasibleCap > 0) {
      return normalizeLeanCap(nearestFeasibleCap);
    }

    if (Number.isFinite(feasibilityRangeHigh) && feasibilityRangeHigh > 0) {
      return normalizeLeanCap(feasibilityRangeHigh);
    }

    const currentCap = Number(budget?.budget_cap ?? 0);
    if (Number.isFinite(currentCap) && currentCap > 0) {
      return normalizeLeanCap(currentCap);
    }

    return 0;
  })();
  const currentBudgetCap = Number(budget?.budget_cap ?? 0);
  const projectedForecastCost = Number(forecast?.projectedCost ?? 0);
  const projectedUtilizationPct =
    currentBudgetCap > 0 ? (projectedForecastCost / currentBudgetCap) * 100 : 0;
  const utilizationProgressPct = Number.isFinite(projectedUtilizationPct)
    ? Math.max(0, Math.min(projectedUtilizationPct, 100))
    : 0;
  const utilizationBarClass =
    projectedUtilizationPct >= 100
      ? 'bg-rose-500'
      : projectedUtilizationPct >= 85
        ? 'bg-amber-500'
        : 'bg-emerald-500';
  const projectedCapGap = currentBudgetCap > 0 ? projectedForecastCost - currentBudgetCap : 0;
  const canApplyOptionA = optionABudgetCap > 0;
  const canApplyOptionB =
    optionBActions.length > 0 &&
    optionBBudgetCap > 0 &&
    plannedMitigationSavings >= OPTION_B_MIN_TOTAL_SAVINGS_SGD &&
    (optionABudgetCap <= 0 || optionBBudgetCap < optionABudgetCap);
  const feasibilityStatusMeta =
    feasibilityStatus === 'achievable'
      ? {
          label: 'Achievable',
          badgeClass: 'bg-emerald-100 text-emerald-700 border-emerald-200',
        }
      : feasibilityStatus === 'stretch'
        ? {
            label: 'Stretch',
            badgeClass: 'bg-amber-100 text-amber-700 border-amber-200',
          }
        : {
            label: 'Not Achievable',
            badgeClass: 'bg-rose-100 text-rose-700 border-rose-200',
          };

  return (
    <div className="flex h-screen bg-white text-gray-900 font-sans selection:bg-blue-100 overflow-hidden">
      {/* SIDEBAR */}
      <aside className="w-[260px] h-screen border-r border-gray-200 flex flex-col justify-between hidden md:flex sticky top-0 overflow-y-auto no-scrollbar bg-white z-20">
        <div>
          <div className="h-16 flex items-center px-6 border-b border-gray-200">
            <div className="w-6 h-6 bg-blue-600 text-white flex items-center justify-center font-bold text-xs rounded shadow-sm mr-3">
              P
            </div>
            <span className="font-semibold text-[15px] tracking-tight">PicoClaw OS</span>
          </div>
          <div className="p-4">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-gray-400" />
              <input
                type="text"
                placeholder="Search"
                className="w-full pl-9 pr-3 py-2 bg-white border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 transition-shadow"
              />
            </div>
          </div>
          <nav className="px-3 space-y-0.5">
            <NavItem icon={<LayoutDashboard size={18} />} label="App Dashboard" active />
            
            {/* 1. Data Sync Panel */}
            <button
              onClick={() => setDataMenuOpen(!dataMenuOpen)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-[14px] font-medium transition-colors ${
                dataMenuOpen ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <div className="flex items-center gap-3">
                <Database className={dataMenuOpen ? 'text-blue-600' : 'text-gray-400'} size={18} />
                Billing Sync
              </div>
              <div className={`transform transition-transform duration-200 ${dataMenuOpen ? 'rotate-180' : ''}`}>
                <ChevronDown className="w-4 h-4 text-gray-400" />
              </div>
            </button>
            {dataMenuOpen && (
              <div className="pl-6 space-y-0.5 bg-gray-50 rounded-md py-2 px-2 m-1 border border-gray-100">
                <p className="text-[11px] text-gray-400 uppercase font-bold mb-2 ml-1">Manual Controls</p>
                <button
                  onClick={runCalculateBill}
                  disabled={runningBillCycle}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-md text-[13px] font-medium text-gray-600 hover:text-gray-900 hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors border border-transparent hover:border-gray-200"
                >
                  <div className="flex items-center gap-3">
                    <div className={runningBillCycle ? 'animate-spin' : ''}>⟳</div>
                    <span>{runningBillCycle ? 'Syncing...' : 'Force Bill Run'}</span>
                  </div>
                  {billRunResult && !billRunError && <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>}
                </button>
              </div>
            )}

            {/* 2. Budget Control Panel */}
            <button
              onClick={() => setBudgetMenuOpen(!budgetMenuOpen)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-[14px] font-medium transition-colors ${
                budgetMenuOpen ? 'bg-emerald-50 text-emerald-700' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <div className="flex items-center gap-3">
                <Wallet className={budgetMenuOpen ? 'text-emerald-600' : 'text-gray-400'} size={18} />
                Change Budget Cap
              </div>
              <div className={`transform transition-transform duration-200 ${budgetMenuOpen ? 'rotate-180' : ''}`}>
                <ChevronDown className="w-4 h-4 text-gray-400" />
              </div>
            </button>
            {budgetMenuOpen && (
              <div className="pl-6 space-y-2 bg-emerald-50/30 rounded-md py-3 px-3 m-1 border border-emerald-100">
                <p className="text-[11px] text-emerald-600 uppercase font-bold">Adjust Monthly Budget Cap</p>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <span className="absolute left-2.5 top-2 text-gray-400 text-xs">$</span>
                    <input 
                      type="text" 
                      value={budgetCapInput}
                      onChange={(e) => setBudgetCapInput(e.target.value)}
                      placeholder="Amount" 
                      className="w-full pl-6 pr-2 py-1.5 text-xs bg-white border border-emerald-200 rounded focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                  </div>
                  <button 
                    disabled={updatingBudget || !budgetCapInput}
                    onClick={handleUpdateBudget}
                    className="bg-emerald-600 text-white text-xs px-3 py-1.5 rounded font-bold hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                  >
                    {updatingBudget ? '...' : 'Set'}
                  </button>
                </div>
                {budgetActionFeedback && (
                  <p className={`text-[10px] font-medium leading-tight ${budgetActionFeedback.type === 'success' ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {budgetActionFeedback.message}
                  </p>
                )}
              </div>
            )}

            {/* 3. Smart Automation Panel */}
            <button
              onClick={() => setAutomationMenuOpen(!automationMenuOpen)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-[14px] font-medium transition-colors ${
                automationMenuOpen ? 'bg-amber-50 text-amber-700' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <div className="flex items-center gap-3">
                <Zap className={automationMenuOpen ? 'text-amber-600' : 'text-gray-400'} size={18} />
                Active Automation
              </div>
              <div className={`transform transition-transform duration-200 ${automationMenuOpen ? 'rotate-180' : ''}`}>
                <ChevronDown className="w-4 h-4 text-gray-400" />
              </div>
            </button>
            {automationMenuOpen && (
              <div className="pl-6 space-y-3 bg-amber-50/30 rounded-md py-3 px-3 m-1 border border-amber-100">
                <p className="text-[11px] text-amber-600 uppercase font-bold">Interventions</p>
                <button
                  disabled={automatingState}
                  onClick={handleAutoShutdown}
                  className="w-full flex items-center gap-2 px-3 py-2 bg-white border border-amber-200 rounded-md text-[12px] font-bold text-amber-700 hover:bg-amber-50 transition-all shadow-sm active:scale-[0.98]"
                >
                  {automatingState ? '⟳ Processing...' : 'Auto-Shutdown Load'}
                </button>
                {automationFeedback && (
                  <p className={`text-[10px] font-medium leading-tight ${automationFeedback.type === 'success' ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {automationFeedback.message}
                  </p>
                )}
              </div>
            )}

            {/* 4. Appliance Monitor Panel */}
            <button
              onClick={() => setApplianceMenuOpen(!applianceMenuOpen)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-[14px] font-medium transition-colors ${
                applianceMenuOpen ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <div className="flex items-center gap-3">
                <LayoutDashboard className={applianceMenuOpen ? 'text-indigo-600' : 'text-gray-400'} size={18} />
                Device Registry
              </div>
              <div className={`transform transition-transform duration-200 ${applianceMenuOpen ? 'rotate-180' : ''}`}>
                <ChevronDown className="w-4 h-4 text-gray-400" />
              </div>
            </button>
            {applianceMenuOpen && (
              <div className="pl-6 space-y-1 bg-indigo-50/20 rounded-md py-2 px-2 m-1 border border-indigo-100">
                <p className="text-[11px] text-indigo-600 uppercase font-bold mb-2 ml-1">Live Appliance Stack</p>
                <div className="space-y-0.5">
                  {(data?.appliances ?? [])
                    .sort((a, b) => (b.currentWatts || 0) - (a.currentWatts || 0))
                    .map((app) => (
                      <div key={app.id} className="flex items-center justify-between p-2 rounded hover:bg-white transition-all group border border-transparent hover:border-indigo-100">
                        <div className="flex flex-col">
                          <span className="text-[11px] font-bold text-gray-700 leading-none">{app.name}</span>
                          <span className="text-[9px] text-gray-400 font-medium uppercase tracking-[0.05em] mt-1 line-clamp-1">{app.room} • {app.currentWatts.toFixed(0)}W</span>
                        </div>
                        <button
                          onClick={() => handleToggleAppliance(app.id, app.state)}
                          disabled={togglingApplianceId === app.id}
                          className={`relative w-8 h-4 rounded-full transition-colors flex items-center px-0.5 ${
                            app.state?.toUpperCase() === 'ON' ? 'bg-[#10b981]' : 'bg-gray-300'
                          } ${togglingApplianceId === app.id ? 'opacity-50' : ''}`}
                        >
                          <div className={`w-3 h-3 bg-white rounded-full transition-transform transform shadow-sm ${
                            app.state?.toUpperCase() === 'ON' ? 'translate-x-4' : 'translate-x-0'
                          }`} />
                        </button>
                      </div>
                    ))}
                </div>
                <p className="text-[9px] text-indigo-500/60 p-2 mt-2 border-t border-indigo-100 italic">
                  * Sorted by live energy consumption.
                </p>
              </div>
            )}
          </nav>
        </div>
        <div>
          <div className="px-6 py-4 border-t border-gray-100 italic text-[10px] text-gray-400 leading-tight">
            Resident Control Center v1.0 <br /> Managed via Composite Microservices
          </div>
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 flex flex-col overflow-hidden bg-white">
        <header className="h-16 border-b border-gray-200 flex items-center justify-between px-6 bg-white overflow-x-auto no-scrollbar">
          <div className="flex items-center text-sm font-medium text-gray-600 gap-2 min-w-max">
            <div className="flex items-center gap-2 border border-blue-200 bg-blue-50/50 px-3 py-1.5 rounded-md hover:bg-blue-50 transition-colors">
              <span className="w-5 h-5 bg-blue-600 text-white border border-blue-600 rounded-full flex items-center justify-center text-[10px] font-black shadow-sm">W</span>
              <span className="font-bold text-blue-900 tracking-tight">wattch-ing</span>
              <span className="bg-blue-600 px-1.5 py-0.5 rounded text-[9px] uppercase font-black text-white shadow-sm">Active</span>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-300" />
            <div className="flex items-center gap-2 border border-gray-200 px-3 py-1.5 rounded-md bg-white">
              <Activity className="w-4 h-4 text-emerald-500" />
              <span className="text-gray-900">{data?.appliances?.filter(a => a.state?.toUpperCase() === 'ON').length || 0} Appliances Running</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <a 
              href="#recent-activities"
              className="flex items-center gap-2 text-sm font-medium text-gray-600 border border-gray-200 px-3 py-1.5 rounded-md hover:bg-gray-50 transition-colors"
            >
              <Database size={16} /> Logs
            </a>
            <div className="flex items-center gap-3 pl-2 border-l border-gray-200">
              <div className="flex flex-col items-end hidden sm:flex">
                <span className="text-xs font-bold text-gray-900 leading-none">{profile?.name || 'Guest User'}</span>
                <span className="text-[10px] font-medium text-gray-400 leading-none mt-1">Resident</span>
              </div>
              <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-black text-xs border border-blue-700 shadow-sm">
                {(profile?.name || 'G').split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
              </div>
            </div>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto p-5 md:p-6 max-w-[1400px] mx-auto w-full">
          <div className="flex justify-between items-center mb-4">
            <h1 className="text-[28px] font-semibold tracking-tight text-gray-900">Your Home</h1>
            {loading && <span className="text-sm text-blue-600 animate-pulse font-medium">Syncing with Microservices...</span>}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            <MetricCard 
              value={`$${displayedAccruedSpend.toFixed(2)}`} 
              label="Accrued Spend" 
              timeframe="This Month" 
            />
            <MetricCard
              value={`${profile?.baseline_monthly_kwh || '---'} kWh`}
              label="Baseline Target"
              timeframe={`HDB Type ${profile?.hdb_type || '?'}`}
            />
            <MetricCard
              value={budgetStatusValue}
              label="Budget Risk"
              timeframe="Live Sync"
              valueColor={budgetStatusColor}
            />
            <MetricCard 
              value={`$${budget?.budget_cap?.toFixed(2) || '---'}`} 
              label="Monthly Budget Cap" 
              timeframe="User Set" 
            />
          </div>

          <div className="mb-5 border border-gray-200 rounded-2xl bg-white p-4 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between gap-3 mb-3 border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <Activity className="w-5 h-5 text-amber-600" />
                <h2 className="text-lg font-bold text-gray-900">Forecast Outlook</h2>
              </div>
              <span className="text-xs font-medium uppercase tracking-wider text-gray-400">
                Forecast
              </span>
            </div>

            {!forecast ? (
              <div className="text-sm text-gray-500">Forecast data is not available yet.</div>
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
                <div className="h-fit rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-4 shadow-sm">
                  <div>
                    <div className="text-xs uppercase tracking-wider text-gray-500">AI Recommendation</div>
                    <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-3 text-base font-semibold leading-8 text-slate-900 md:text-lg">
                      {recommendationParagraph}
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2">
                    <ForecastStat
                      label="Risk"
                      value={forecast.riskLevel}
                    />
                    <ForecastStat
                      label="Projected Spend"
                      value={`$${forecast.projectedCost.toFixed(2)}`}
                    />
                    <ForecastStat
                      label="Days To Exceed"
                      value={forecast.daysToExceed === null ? 'N/A' : String(forecast.daysToExceed)}
                    />
                    <ForecastStat
                      label="Month"
                      value={forecast.month}
                    />
                  </div>

                  <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                        Budget Trajectory
                      </div>
                      <div className="text-xs font-medium text-slate-600">
                        {currentBudgetCap > 0 ? `${projectedUtilizationPct.toFixed(1)}% of cap` : 'Cap unavailable'}
                      </div>
                    </div>
                    <div className="mt-2 h-2 rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${utilizationBarClass}`}
                        style={{ width: `${utilizationProgressPct}%` }}
                      />
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-600">
                      <span>Projected: ${projectedForecastCost.toFixed(2)}</span>
                      <span>{currentBudgetCap > 0 ? `Cap: $${currentBudgetCap.toFixed(2)}` : 'Set cap to compare'}</span>
                    </div>
                    {currentBudgetCap > 0 && (
                      <p className={`mt-1 text-xs font-medium ${projectedCapGap > 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                        {projectedCapGap > 0
                          ? `Over cap by $${projectedCapGap.toFixed(2)}`
                          : `$${Math.abs(projectedCapGap).toFixed(2)} below cap`}
                      </p>
                    )}
                  </div>

                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                      <div className="text-xs font-semibold uppercase tracking-wider text-emerald-700">Option A</div>
                      <div className="mt-1 text-lg font-bold text-emerald-800">
                        {canApplyOptionA ? `$${optionABudgetCap.toFixed(2)}` : 'Unavailable'}
                      </div>
                      <div className="mt-1 text-xs text-emerald-700/90">
                        {hasActiveOffOverrides
                          ? 'Baseline SAFE cap with appliance restore.'
                          : 'Baseline SAFE cap (all appliances already ON).'}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-100 p-3">
                      <div className="text-xs font-semibold uppercase tracking-wider text-slate-600">Option B</div>
                      <div className="mt-1 text-lg font-bold text-slate-900">
                        {canApplyOptionB ? `$${optionBBudgetCap.toFixed(2)}` : 'Conditional'}
                      </div>
                      <div className="mt-1 text-xs text-slate-600">
                        {canApplyOptionB
                          ? `${optionBActions.length} OFF action${optionBActions.length === 1 ? '' : 's'} · Save ~$${plannedMitigationSavings.toFixed(2)}`
                          : 'Needs lower cap than Option A and meaningful savings.'}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-4 shadow-sm">
                  <button
                    type="button"
                    onClick={() => setSuggestedActionsOpen((open) => !open)}
                    aria-expanded={suggestedActionsOpen}
                    aria-controls="suggested-actions-panel"
                    className="w-full flex items-center justify-between gap-3 text-left"
                  >
                    <div>
                      <div className="text-xs uppercase tracking-wider text-gray-500">Actions</div>
                      <div className="mt-1 text-sm font-semibold text-gray-800">Temporary OFF Plan</div>
                    </div>
                    <ChevronDown
                      className={`w-5 h-5 text-gray-500 transition-transform duration-300 ${
                        suggestedActionsOpen ? 'rotate-180' : 'rotate-0'
                      }`}
                    />
                  </button>

                  {forecastRecommendation?.target && (
                    <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4 text-slate-800 shadow-sm">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                          Feasibility
                        </div>
                        <span
                          className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${feasibilityStatusMeta.badgeClass}`}
                        >
                          {feasibilityStatusMeta.label}
                        </span>
                      </div>

                      <p className="mt-2 text-sm leading-6 text-slate-600">
                        Can your current cap return to SAFE with practical temporary OFF actions?
                      </p>
                      <p className="mt-1 text-xs leading-5 text-slate-500">
                        Safety target: {(targetSafetyThresholdRatio * 100).toFixed(0)}% of budget cap.
                      </p>

                      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <div className="text-xs font-medium uppercase tracking-wider text-slate-500">Cap Range</div>
                          <div className="mt-1 text-base font-semibold text-slate-900">{feasibilityRangeLabel}</div>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <div className="text-xs font-medium uppercase tracking-wider text-slate-500">Nearest Cap</div>
                          <div className="mt-1 text-base font-semibold text-slate-900">${nearestFeasibleCap.toFixed(2)}</div>
                        </div>
                      </div>

                      <div className="mt-3 text-sm leading-6 text-slate-600">
                      </div>
                      <div className="mt-1 text-xs leading-5 text-slate-500">
                        Option A is live-calculated. 
                      </div>
                      {!optionBModeActive && canApplyOptionA && (
                        <button
                          type="button"
                          onClick={handleApplyOptionAPlan}
                          disabled={
                            applyingOptionA ||
                            applyingOptionB ||
                            applyingAllActions ||
                            applyingActionId !== null ||
                            restoringAllActions ||
                            restoringActionId !== null
                          }
                          className="mt-3 w-full rounded-md bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
                        >
                          {applyingOptionA
                            ? 'Applying Option A'
                            : hasActiveOffOverrides
                              ? `Option A: Restore appliances + set SAFE cap $${optionABudgetCap.toFixed(2)}`
                              : `Option A: Set SAFE cap $${optionABudgetCap.toFixed(2)}`}
                        </button>
                      )}
                      {!optionBModeActive && canApplyOptionB && (
                        <button
                          type="button"
                          onClick={handleApplyOptionBPlan}
                          disabled={
                            applyingOptionA ||
                            applyingOptionB ||
                            applyingAllActions ||
                            applyingActionId !== null ||
                            restoringAllActions ||
                            restoringActionId !== null
                          }
                          className="mt-3 w-full rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                        >
                          {applyingOptionB
                            ? 'Applying Option B'
                            : `Option B: Save cap $${optionBBudgetCap.toFixed(2)} + ${optionBActions.length} OFF action${optionBActions.length === 1 ? '' : 's'}`}
                        </button>
                      )}
                      {!optionBModeActive && !canApplyOptionB && recommendedActionItems.length > 0 && (
                        <p className="mt-2 text-xs text-amber-700">
                          Option B appears when the cap is below Option A and savings are meaningful.
                        </p>
                      )}
                      {optionBModeActive && (
                        <p className="mt-2 text-xs text-emerald-700">
                          Temporary OFF plan is active. Turn all appliances back ON to return to default view.
                        </p>
                      )}
                      {feasibilityStatus === 'not_achievable' && (
                        <div className="mt-2 text-sm font-medium text-rose-600">
                          Gap to SAFE target with current budget cap: ${feasibilityGap.toFixed(2)}.
                        </div>
                      )}
                    </div>
                  )}

                  <div
                    id="suggested-actions-panel"
                    className={`transition-all duration-300 ease-in-out ${
                      suggestedActionsOpen
                        ? 'max-h-[70vh] overflow-y-auto opacity-100 mt-4 pt-3 border-t border-gray-200 pr-1'
                        : 'max-h-0 overflow-hidden opacity-0'
                    }`}
                  >
                    {!isActionableRisk ? (
                      <div className="text-sm text-gray-600">Risk is SAFE. No shutdown action needed now.</div>
                    ) : suggestedAppliances.length === 0 ? (
                      <div className="space-y-1 text-sm text-gray-700">
                        <p>All controllable appliances are already OFF.</p>
                        {activeOffOverrideNames.length > 0 && (
                          <p className="text-xs text-gray-500">
                            Active OFF overrides: {activeOffOverrideNames.join(', ')}
                          </p>
                        )}
                        {remainingSavingsForSafetyNet > 0 && (
                          <p className="text-xs text-gray-500">
                            More savings needed: ${remainingSavingsForSafetyNet.toFixed(2)}
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                        <div className="font-medium text-slate-900">Use Option B above to apply the OFF plan.</div>
                        {plannedMitigationSavings > 0 && (
                          <p className="mt-1 text-xs font-medium text-slate-700">
                            Apply all saves about ${plannedMitigationSavings.toFixed(2)}.
                          </p>
                        )}
                      </div>
                    )}

                    {reactivationItems.length > 0 && (
                      <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <div>
                            <div className="text-xs uppercase tracking-wider text-emerald-700">Restore Appliances</div>
                            <div className="text-sm font-semibold text-emerald-800">Turn Back ON</div>
                          </div>
                        </div>
                        {reactivationItems.length > 0 && (
                          <button
                            type="button"
                            onClick={() => handleTurnOnAllAppliances(reactivationItems)}
                            disabled={
                              applyingOptionB ||
                              applyingOptionA ||
                              restoringAllActions ||
                              restoringActionId !== null ||
                              applyingAllActions ||
                              applyingActionId !== null
                            }
                            className="mb-2 w-full rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                          >
                            {restoringAllActions ? 'Turning All On' : `Turn All Back ON (${reactivationItems.length})`}
                          </button>
                        )}
                        <div className="space-y-2">
                          {reactivationItems.map((item) => (
                          <div
                            key={`reactivate-${item.applianceId}`}
                            className="flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-white px-3 py-2"
                          >
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-emerald-800">{item.name}</div>
                              <div className="text-xs text-emerald-700/80">
                                Currently OFF due to manual override
                                {item.until ? ` until ${formatUtcTimestamp(item.until)}` : ''}
                              </div>
                            </div>
                            {!optionBModeActive && (
                              <button
                                type="button"
                                onClick={() => handleTurnOnAppliance(item)}
                                disabled={
                                  applyingOptionB ||
                                  applyingOptionA ||
                                  restoringAllActions ||
                                  restoringActionId === item.applianceId ||
                                  applyingAllActions ||
                                  applyingActionId !== null
                                }
                                className="shrink-0 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                              >
                                {restoringAllActions || restoringActionId === item.applianceId ? 'Turning On' : 'Turn ON'}
                              </button>
                            )}
                          </div>
                        ))}
                        </div>
                      </div>
                    )}

                    {actionFeedback && (
                      <p className={`mt-3 text-xs font-medium ${actionFeedback.type === 'success' ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {actionFeedback.message}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-6 mb-8">
             <SpatialEnergyPanel appliances={data?.appliances} />
          </div>

          {/* NEW: Recent Logs Section */}
          <div id="recent-activities" className="mt-4 border border-gray-200 rounded-2xl bg-white p-6 shadow-sm overflow-hidden scroll-mt-6">
            <div className="flex items-center gap-2 mb-6 border-b border-gray-100 pb-4">
              <Activity className="w-5 h-5 text-blue-600" />
              <h2 className="text-lg font-bold text-gray-900">Recent System Activities</h2>
            </div>
            
            <div className="space-y-4">
              {history.length > 0 ? (
                history.slice(0, 5).map((log) => (
                  <div key={log.log_id} className="flex items-start gap-4 p-3 hover:bg-gray-50 rounded-lg transition-colors border-l-2 border-blue-500">
                    <div className="min-w-[140px] text-[12px] font-bold text-gray-400 uppercase tracking-tight">
                      {formatUtcTimestamp(log.occurred_at)}
                    </div>
                    <div className="text-sm font-medium text-gray-700">
                      {log.message}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-gray-400 italic font-medium">
                  No activity logs found.
                </div>
              )}
            </div>
          </div>

          <div className="mt-6 border border-gray-200 rounded-2xl bg-white p-6 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between gap-3 mb-6 border-b border-gray-100 pb-4">
              <div className="flex items-center gap-2">
                <Server className="w-5 h-5 text-emerald-600" />
                <h2 className="text-lg font-bold text-gray-900">Live Billing Status</h2>
              </div>
              <span className="text-xs font-medium uppercase tracking-wider text-gray-400">
                Auto refresh every 5 Minutes
              </span>
            </div>

            {cronStateLoading ? (
              <div className="text-sm text-gray-500">Loading cron state...</div>
            ) : cronStateError ? (
              <div className="text-sm text-rose-600">Unable to load cron state: {cronStateError}</div>
            ) : !cronUserState ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <div className="text-xs uppercase tracking-wider text-gray-500">Current Month</div>
                  <div className="text-xl font-semibold text-gray-900 mt-1">{fallbackMonth}</div>
                </div>
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <div className="text-xs uppercase tracking-wider text-gray-500">Running Total</div>
                  <div className="text-xl font-semibold text-emerald-700 mt-1">
                    ${displayedAccruedSpend.toFixed(4)}
                  </div>
                </div>
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <div className="text-xs uppercase tracking-wider text-gray-500">Last Updated</div>
                  <div className="text-sm font-semibold text-gray-900 mt-2">
                    {data?.fetched_at ? formatUtcTimestamp(data.fetched_at) : 'Warming up'}
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <div className="text-xs uppercase tracking-wider text-gray-500">Current Month</div>
                    <div className="text-xl font-semibold text-gray-900 mt-1">{cronUserState.month ?? 'Unknown'}</div>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <div className="text-xs uppercase tracking-wider text-gray-500">Running Total</div>
                    <div className="text-xl font-semibold text-emerald-700 mt-1">
                      ${Number(cronUserState.running_total ?? 0).toFixed(4)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <div className="text-xs uppercase tracking-wider text-gray-500">Last Updated</div>
                    <div className="text-sm font-semibold text-gray-900 mt-2">
                      {cronUserState.updated_at
                        ? formatUtcTimestamp(cronUserState.updated_at)
                        : 'Unknown'}
                    </div>
                  </div>
                </div>
                {cronUserState.closed_month && (
                  <p className="mt-3 text-xs font-medium text-slate-600">
                    Budget reset recorded for {cronUserState.closed_month}. New cycle is now {cronUserState.month ?? fallbackMonth}.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function NavItem({
  icon,
  label,
  active = false,
  hasChevron,
  href = "#",
}: {
  icon: React.ReactElement<{ className?: string }>;
  label: string;
  active?: boolean;
  hasChevron?: boolean;
  href?: string;
}) {
  return (
    <a
      href={href}
      className={`flex items-center justify-between px-3 py-2 rounded-md text-[14px] font-medium transition-colors ${
        active ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
      }`}
    >
      <div className="flex items-center gap-3">
        {React.cloneElement(icon, { className: active ? 'text-blue-600' : 'text-gray-400' })}
        {label}
      </div>
      {hasChevron && <ChevronDown className="w-4 h-4 text-gray-400" />}
    </a>
  );
}

function MetricCard({ value, label, timeframe, valueColor = 'text-gray-900' }: { value: string | number; label: string; timeframe: string; valueColor?: string }) {
  return (
    <div className="border border-gray-200 rounded-lg p-5 bg-white flex flex-col justify-between h-[120px] shadow-sm hover:shadow transition-shadow">
      <div className={`text-[32px] md:text-[40px] leading-none font-semibold ${valueColor} truncate`}>{value}</div>
      <div className="flex justify-between items-end mt-4">
        <span className="text-sm font-medium text-gray-900 truncate">{label}</span>
        <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">{timeframe}</span>
      </div>
    </div>
  );
}

function ForecastStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wider text-gray-500">{label}</div>
      <div className="mt-2 text-xl font-semibold text-gray-900">{value}</div>
    </div>
  );
}
