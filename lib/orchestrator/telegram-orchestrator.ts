import { getAppliances } from "@/lib/services/appliance/appliance.service";
import { requestChange } from "@/lib/services/request-change/request-change.service";
import {
  getForecast,
  getForecastRecommendation,
} from "@/lib/services/forecast/forecast.service";
import { getHistory } from "@/lib/services/history/history.service";
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
  durationMinutes?: number;
  duration_minutes?: number;
  monthlyCap?: number;
  user_id?: number;
}

function parseDurationMinutes(params: OrchestratorParams): number | undefined {
  const candidate =
    typeof params.durationMinutes === "number"
      ? params.durationMinutes
      : params.duration_minutes;

  if (typeof candidate !== "number" || !Number.isFinite(candidate)) {
    return undefined;
  }

  return Math.max(1, Math.floor(candidate));
}

function formatTelegramForecastActions(
  recommendations: Array<{
    name?: string;
    suggestedDurationMinutes?: number;
  }> | undefined,
): string[] {
  if (!Array.isArray(recommendations)) {
    return [];
  }

  return recommendations
    .slice(0, 3)
    .map((item) => {
      const name = typeof item.name === "string" ? item.name.trim() : "Appliance";
      const minutes = Number(item.suggestedDurationMinutes ?? 0);
      if (!Number.isFinite(minutes) || minutes <= 0) {
        return `OFF ${name}`;
      }
      return `OFF ${name} ${Math.round(minutes)}m`;
    });
}

type TelegramOffAction = {
  label: string;
  command: string;
  applianceId: string;
  applianceName: string;
  durationMinutes: number;
};

function buildTelegramOffAction(
  recommendations:
    | Array<{
        applianceId?: string;
        name?: string;
        suggestedDurationMinutes?: number;
      }>
    | undefined,
  fallbackDurationMinutes?: number,
): TelegramOffAction | null {
  if (!Array.isArray(recommendations) || recommendations.length === 0) {
    return null;
  }

  const top = recommendations[0];
  const applianceId = typeof top.applianceId === "string" ? top.applianceId.trim() : "";
  if (!applianceId) {
    return null;
  }

  const applianceName =
    typeof top.name === "string" && top.name.trim().length > 0
      ? top.name.trim()
      : "Appliance";

  const rawDuration = Number(
    top.suggestedDurationMinutes ?? fallbackDurationMinutes ?? 60,
  );
  const durationMinutes =
    Number.isFinite(rawDuration) && rawDuration > 0
      ? Math.max(1, Math.round(rawDuration))
      : 60;

  return {
    label: `OFF ${applianceName} ${durationMinutes}m`,
    command: `/off ${applianceId} ${durationMinutes}`,
    applianceId,
    applianceName,
    durationMinutes,
  };
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
    const [forecast, recommendation] = await Promise.all([
      getForecast(uid),
      getForecastRecommendation(uid).catch(() => null),
    ]);

    const quickActions = formatTelegramForecastActions(
      recommendation?.recommendations,
    );
    const telegramOffAction = buildTelegramOffAction(
      recommendation?.recommendations,
      recommendation?.recommendedDurationMinutes,
    );

    return {
      ...forecast,
      quickActions,
      telegramOffAction,
      telegramSummary:
        telegramOffAction
          ? `Risk ${forecast.riskLevel}. Tap ${telegramOffAction.label} or reply /keep.`
          : quickActions.length > 0
            ? `Risk ${forecast.riskLevel}. ${quickActions.join("; ")}.`
          : `Risk ${forecast.riskLevel}. No action now.`,
      recommendation: recommendation
        ? {
            predictedRiskLevel: recommendation.predictedRiskLevel,
            recommendedDurationMinutes: recommendation.recommendedDurationMinutes,
          }
        : undefined,
    };
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
    return requestChange({
      uid,
      aid: params.aid,
      targetState: "OFF",
      durationMinutes: parseDurationMinutes(params),
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
