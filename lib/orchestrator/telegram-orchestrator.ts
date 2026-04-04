import { getAppliances } from "@/lib/services/appliance/appliance.service";
import { getBudgetStatus, updateMonthlyCap } from "@/lib/services/budget/budget.service";
import { changeApplianceState } from "@/lib/services/change-appliance-state/change-appliance-state.service";
import { getForecast } from "@/lib/services/forecast/forecast.service";
import { getHistory, logHistory } from "@/lib/services/history/history.service";
import { getUserProfile } from "@/lib/services/profile/profile.service";
import { getRate } from "@/lib/services/rate/rate.service";
import { DEMO_UID } from "@/lib/shared/constants";
import type { TelegramIntent } from "@/lib/shared/types";

interface OrchestratorParams {
  uid?: string;
  aid?: string;
  monthlyCap?: number;
}

export async function handleTelegramIntent(
  intent: TelegramIntent,
  params: OrchestratorParams = {},
) {
  const uid = params.uid ?? DEMO_UID;

  if (intent === "status") {
    return {
      budget: getBudgetStatus(uid),
      appliances: await getAppliances(uid),
      rate: await getRate(),
    };
  }

  if (intent === "forecast") {
    return getForecast(uid);
  }

  if (intent === "set_budget") {
    if (typeof params.monthlyCap !== "number" || !Number.isFinite(params.monthlyCap)) {
      return { error: "monthlyCap is required for set_budget." };
    }

    const budget = updateMonthlyCap(uid, params.monthlyCap);
    if (budget) {
      try {
        await logHistory(uid, `Monthly cap updated to $${params.monthlyCap}.`);
      } catch (error) {
        console.warn("History logging failed after set_budget intent:", error);
      }
    }
    return budget;
  }

  if (intent === "shutdown") {
    return changeApplianceState({
      uid,
      aid: params.aid,
      targetState: "OFF",
    });
  }

  if (intent === "history") {
    return await getHistory(uid);
  }

  if (intent === "profile") {
    return getUserProfile(uid);
  }

  if (intent === "rate") {
    return await getRate();
  }

  return { error: `Unsupported intent: ${intent}` };
}
