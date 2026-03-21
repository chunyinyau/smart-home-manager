import { shutdownLowestPriorityAppliance } from "@/lib/services/automation/automation.service";
import { getAppliances, shutdownAppliance } from "@/lib/services/appliance/appliance.service";
import { getBudgetStatus, updateMonthlyCap } from "@/lib/services/budget/budget.service";
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
      appliances: getAppliances(uid),
      rate: getRate(),
    };
  }

  if (intent === "forecast") {
    return getForecast(uid);
  }

  if (intent === "set_budget") {
    if (typeof params.monthlyCap !== "number") {
      return { error: "monthlyCap is required for set_budget." };
    }

    const budget = updateMonthlyCap(uid, params.monthlyCap);
    if (budget) {
      logHistory(uid, "BUDGET_UPDATED", "orchestrator", `Monthly cap updated to $${params.monthlyCap}.`);
    }
    return budget;
  }

  if (intent === "shutdown") {
    if (params.aid) {
      const appliance = shutdownAppliance(params.aid);
      if (appliance) {
        logHistory(uid, "APPLIANCE_SHUTDOWN", "orchestrator", `User requested shutdown for ${appliance.name}.`, appliance.id);
      }
      return appliance;
    }
    return shutdownLowestPriorityAppliance(uid);
  }

  if (intent === "history") {
    return getHistory(uid);
  }

  if (intent === "profile") {
    return getUserProfile(uid);
  }

  if (intent === "rate") {
    return getRate();
  }

  return { error: `Unsupported intent: ${intent}` };
}
