import { getAppliances } from "@/lib/services/appliance/appliance.service";
import { changeApplianceState } from "@/lib/services/change-appliance-state/change-appliance-state.service";
import { getForecast } from "@/lib/services/forecast/forecast.service";
import { getHistory, logHistory } from "@/lib/services/history/history.service";
import { getUserProfile } from "@/lib/services/profile/profile.service";
import { getRate } from "@/lib/services/rate/rate.service";
import {
  extractErrorMessage,
  fetchService,
  readJsonBody,
} from "@/lib/clients/service-discovery";
import { fetchPublicEndpoint, resolvePublicEndpointUrl } from "@/lib/clients/public-endpoints";
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

type CalculateBillPayload = {
  success?: boolean;
  error?: string;
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

async function updateMonthlyCap(userId: number, monthlyCap: number) {
  const roundedMonthlyCap = Number(monthlyCap.toFixed(2));
  const publicUrl = resolvePublicEndpointUrl(
    ["OPENCLAW_UPDATE_BUDGET_URL", "UPDATE_BUDGET_PUBLIC_URL"],
    { userId },
  );

  if (publicUrl) {
    const publicMethod = publicUrl.includes(String(userId)) ? "PUT" : "POST";
    const response = await fetchPublicEndpoint(
      ["OPENCLAW_UPDATE_BUDGET_URL", "UPDATE_BUDGET_PUBLIC_URL"],
      { userId },
      {
        method: publicMethod,
        body:
          publicMethod === "PUT"
            ? { budget_cap: roundedMonthlyCap, monthlyCap: roundedMonthlyCap }
            : { user_id: userId, budget_cap: roundedMonthlyCap, monthlyCap: roundedMonthlyCap },
        timeoutMs: 12000,
      },
    );

    if (!response) {
      throw new Error("Public update budget endpoint is not configured");
    }

    const payload = await readJsonBody<BudgetServicePayload>(response);

    if (!response.ok || payload?.success === false) {
      throw new Error(
        extractErrorMessage(payload, `Update budget endpoint returned HTTP ${response.status}`),
      );
    }

    return payload?.data ?? payload ?? null;
  }

  const response = await fetchService("budget", `/api/budget/${userId}/cap`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ budget_cap: roundedMonthlyCap }),
  });
  const payload = await readJsonBody<BudgetServicePayload>(response);

  if (!response.ok || payload?.success === false) {
    throw new Error(
      extractErrorMessage(payload, `Budget service returned HTTP ${response.status}`),
    );
  }

  return payload?.data ?? null;
}

async function syncLatestBilling(userId: number, uid: string) {
  const response = await fetchService("calculatebill", "/api/calculatebill/run", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      user_id: userId,
      uid,
      interval_minutes: 5,
      sync_budget: true,
    }),
    timeoutMs: 12000,
  });
  const payload = await readJsonBody<CalculateBillPayload>(response);

  if (!response.ok || payload?.success === false) {
    throw new Error(
      extractErrorMessage(payload, `CalculateBill service returned HTTP ${response.status}`),
    );
  }

  return payload?.data ?? null;
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

    const requestedMonthlyCap = Number(params.monthlyCap.toFixed(2));
    const billingSync = await syncLatestBilling(userId, uid);
    const forecast = await getForecast(uid);
    const projectedMonthlySpend = Number(forecast.projectedCost ?? 0);

    if (requestedMonthlyCap < projectedMonthlySpend) {
      const message = `Budget update rejected. Requested cap of $${requestedMonthlyCap.toFixed(2)} is below projected spend of $${projectedMonthlySpend.toFixed(2)}.`;

      try {
        await logHistory(uid, message);
      } catch (error) {
        console.warn("History logging failed after rejected set_budget intent:", error);
      }

      return {
        accepted: false,
        action: "budget_update_rejected",
        requestedMonthlyCap,
        projectedMonthlySpend,
        forecast,
        billingSync,
        message,
      };
    }

    const budget = await updateMonthlyCap(userId, requestedMonthlyCap);
    const refreshedForecast = await getForecast(uid);
    const message = `Budget updated to $${requestedMonthlyCap.toFixed(2)} after validating projected spend of $${projectedMonthlySpend.toFixed(2)}.`;

    try {
      await logHistory(uid, message);
    } catch (error) {
      console.warn("History logging failed after accepted set_budget intent:", error);
    }

    return {
      accepted: true,
      action: "budget_update_accepted",
      requestedMonthlyCap,
      projectedMonthlySpend,
      forecast: refreshedForecast,
      billingSync,
      budget,
      message,
    };
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
