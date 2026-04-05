import { getAppliances } from "@/lib/services/appliance/appliance.service";
import { changeApplianceState } from "@/lib/services/change-appliance-state/change-appliance-state.service";
import { getForecast } from "@/lib/services/forecast/forecast.service";
import { getHistory } from "@/lib/services/history/history.service";
import { getUserProfile } from "@/lib/services/profile/profile.service";
import { getRate } from "@/lib/services/rate/rate.service";
import {
  extractErrorMessage,
  fetchService,
  readJsonBody,
} from "@/lib/clients/service-discovery";
import { DEMO_UID } from "@/lib/shared/constants";
import type { TelegramIntent } from "@/lib/shared/types";

interface OrchestratorParams {
  uid?: string;
  aid?: string;
  monthlyCap?: number;
  user_id?: number;
}

type BudgetServicePayload = {
  success?: boolean;
  error?: string;
  data?: {
    budget_id: number;
    user_id: number;
    budget_cap: number;
    cum_bill: number;
  };
};

type UpdateBudgetPayload = {
  success?: boolean;
  accepted?: boolean;
  action?: string;
  message?: string;
  error?: string;
  requestedMonthlyCap?: number;
  projectedMonthlySpend?: number;
  forecast?: Record<string, unknown>;
  billingSync?: Record<string, unknown>;
  budget?: Record<string, unknown>;
  history?: Record<string, unknown>;
  data?: Record<string, unknown>;
};

function resolveUserId(uid: string, explicitUserId?: number): number {
  if (typeof explicitUserId === "number" && Number.isSafeInteger(explicitUserId) && explicitUserId > 0) {
    return explicitUserId;
  }

  const parsedFromUid = Number(uid);
  if (Number.isSafeInteger(parsedFromUid) && parsedFromUid > 0) {
    return parsedFromUid;
  }

  return 1;
}

async function getBudgetStatus(userId: number) {
  const response = await fetchService("budget", `/api/budget/${userId}`);
  const payload = await readJsonBody<BudgetServicePayload>(response);

  if (!response.ok || payload?.success === false) {
    throw new Error(
      extractErrorMessage(payload, `Budget service returned HTTP ${response.status}`),
    );
  }

  return payload?.data ?? null;
}

async function updateBudgetComposite(userId: number, uid: string, monthlyCap: number) {
  const response = await fetchService("updatebudget", `/api/updatebudget/${userId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      uid,
      budget_cap: Number(monthlyCap.toFixed(2)),
    }),
    timeoutMs: 15000,
  });
  const payload = await readJsonBody<UpdateBudgetPayload>(response);

  if (!response.ok || payload?.success === false) {
    throw new Error(
      extractErrorMessage(payload, `UpdateBudget service returned HTTP ${response.status}`),
    );
  }

  if (!payload || typeof payload !== "object") {
    throw new Error("UpdateBudget service returned an empty payload");
  }

  return payload;
}

export async function handleTelegramIntent(
  intent: TelegramIntent,
  params: OrchestratorParams = {},
) {
  const uid = params.uid ?? DEMO_UID;
  const userId = resolveUserId(uid, params.user_id);

  if (intent === "status") {
    return {
      budget: await getBudgetStatus(userId),
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

    return updateBudgetComposite(userId, uid, params.monthlyCap);
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
