import { NextResponse } from "next/server";
import { DEMO_UID } from "@/lib/shared/constants";
import { getForecastRecommendation } from "@/lib/services/forecast/forecast.service";
import { requestChange } from "@/lib/services/request-change/request-change.service";
import {
  extractErrorMessage,
  fetchService,
  readJsonBody,
} from "@/lib/clients/service-discovery";

type BudgetResponsePayload = {
  success?: boolean;
  error?: string;
  data?: {
    user_id?: number;
    budget_cap?: number;
  };
};

type OptionARequestPayload = {
  uid?: string;
  userId?: number;
  budgetCap?: number;
  restoreOverrides?: boolean;
};

type ApplianceSnapshot = {
  id?: string;
  name?: string;
  state?: string;
  manualOverride?: {
    active?: boolean;
    state?: string;
  };
};

function parsePositiveInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  const parsed = Math.floor(value);
  if (parsed <= 0) {
    return null;
  }

  return parsed;
}

function parsePositiveAmount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  if (value <= 0) {
    return null;
  }

  return Number(value.toFixed(2));
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  return fallback;
}

async function fetchActiveOffOverrides(uid: string): Promise<Array<{ applianceId: string; name: string }>> {
  const response = await fetchService("appliance", `/api/appliance?uid=${encodeURIComponent(uid)}`, {
    timeoutMs: 15000,
  });
  const payload = await readJsonBody<ApplianceSnapshot[] | Record<string, unknown>>(response);

  if (!response.ok || !Array.isArray(payload)) {
    throw new Error(
      extractErrorMessage(payload, `Appliance list failed with HTTP ${response.status}`),
    );
  }

  return payload
    .map((item) => {
      const applianceId = typeof item?.id === "string" ? item.id.trim() : "";
      if (!applianceId) {
        return null;
      }

      const state = typeof item?.state === "string" ? item.state.toUpperCase() : "";
      const overrideState = typeof item?.manualOverride?.state === "string"
        ? item.manualOverride.state.toUpperCase()
        : "";
      const overrideActive = Boolean(item?.manualOverride?.active);

      if (!(state === "OFF" && overrideActive && overrideState === "OFF")) {
        return null;
      }

      const name = typeof item?.name === "string" && item.name.trim().length > 0
        ? item.name.trim()
        : applianceId;

      return { applianceId, name };
    })
    .filter((item): item is { applianceId: string; name: string } => item !== null);
}

async function restoreActiveOverrides(uid: string): Promise<{
  requestedCount: number;
  restoredCount: number;
  failedCount: number;
  restored: Array<{ applianceId: string; name: string }>;
  failed: Array<{ applianceId: string; name: string; error: string }>;
}> {
  const targets = await fetchActiveOffOverrides(uid);
  const restored: Array<{ applianceId: string; name: string }> = [];
  const failed: Array<{ applianceId: string; name: string; error: string }> = [];

  for (const target of targets) {
    try {
      const result = await requestChange({
        uid,
        aid: target.applianceId,
        targetState: "ON",
      });

      if (typeof result?.error === "string" && result.error.trim().length > 0) {
        throw new Error(result.error);
      }

      restored.push(target);
    } catch (error) {
      failed.push({
        applianceId: target.applianceId,
        name: target.name,
        error: error instanceof Error ? error.message : "Failed to restore appliance",
      });
    }
  }

  return {
    requestedCount: targets.length,
    restoredCount: restored.length,
    failedCount: failed.length,
    restored,
    failed,
  };
}

async function ensureBudgetExists(userId: number): Promise<void> {
  const getResponse = await fetchService("budget", `/api/budget/${userId}`, {
    timeoutMs: 15000,
  });
  const getPayload = await readJsonBody<BudgetResponsePayload>(getResponse);

  if (getResponse.ok && getPayload?.success !== false) {
    return;
  }

  if (getResponse.status !== 404) {
    throw new Error(
      extractErrorMessage(getPayload, `Budget service returned HTTP ${getResponse.status}`),
    );
  }

  const createResponse = await fetchService("budget", "/api/budget", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ user_id: userId }),
    timeoutMs: 15000,
  });
  const createPayload = await readJsonBody<BudgetResponsePayload>(createResponse);

  if (!createResponse.ok || createPayload?.success === false) {
    throw new Error(
      extractErrorMessage(
        createPayload,
        `Budget service create returned HTTP ${createResponse.status}`,
      ),
    );
  }
}

async function persistBudgetCap(userId: number, budgetCap: number): Promise<{
  userId: number;
  budgetCap: number;
}> {
  await ensureBudgetExists(userId);

  const response = await fetchService("budget", `/api/budget/${userId}/cap`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ budget_cap: budgetCap }),
    timeoutMs: 15000,
  });
  const payload = await readJsonBody<BudgetResponsePayload>(response);

  if (!response.ok || payload?.success === false) {
    throw new Error(
      extractErrorMessage(payload, `Budget cap update failed with HTTP ${response.status}`),
    );
  }

  return {
    userId,
    budgetCap: Number(payload?.data?.budget_cap ?? budgetCap),
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as OptionARequestPayload;

    const uid = typeof body.uid === "string" && body.uid.trim().length > 0
      ? body.uid.trim()
      : DEMO_UID;

    const userId = parsePositiveInteger(body.userId) ?? 1;
    const restoreOverrides = parseBoolean(body.restoreOverrides, true);

    let restoreResult: Awaited<ReturnType<typeof restoreActiveOverrides>> | null = null;
    if (restoreOverrides) {
      restoreResult = await restoreActiveOverrides(uid);
    }

    let recommendation = await getForecastRecommendation(uid).catch(() => null);

    // Keep Option A at or above the computed safe minimum, while honoring a higher requested cap.
    const recommendationCap = parsePositiveAmount(recommendation?.target?.safeMinimumBudgetCap);
    const requestedCap = parsePositiveAmount(body.budgetCap);

    let budgetCap: number | null = null;
    if (recommendationCap !== null && requestedCap !== null) {
      budgetCap = Number(Math.max(recommendationCap, requestedCap).toFixed(2));
    } else {
      budgetCap = recommendationCap ?? requestedCap;
    }

    if (budgetCap === null && recommendation === null) {
      recommendation = await getForecastRecommendation(uid);
      const fallbackRecommendationCap = parsePositiveAmount(recommendation?.target?.safeMinimumBudgetCap);
      if (fallbackRecommendationCap !== null && requestedCap !== null) {
        budgetCap = Number(Math.max(fallbackRecommendationCap, requestedCap).toFixed(2));
      } else {
        budgetCap = fallbackRecommendationCap ?? requestedCap;
      }
    }

    if (budgetCap === null) {
      return NextResponse.json(
        {
          success: false,
          error: "Unable to resolve Option A budget cap from request or forecast recommendation.",
        },
        { status: 400 },
      );
    }

    const budgetResult = await persistBudgetCap(userId, budgetCap);
    const recommendationAfter = await getForecastRecommendation(uid).catch(() => null);
    const success = !restoreResult || restoreResult.failedCount === 0;

    return NextResponse.json(
      {
        success,
        option: "option_a_safe_minimum",
        uid,
        budget: {
          updated: true,
          userId: budgetResult.userId,
          budgetCap: budgetResult.budgetCap,
        },
        restoredOverrides: restoreResult,
        recommendationAfter,
        message: restoreResult && restoreResult.requestedCount > 0
          ? `Option A applied. Restored ${restoreResult.restoredCount}/${restoreResult.requestedCount} appliance override(s), then set budget cap to $${budgetResult.budgetCap.toFixed(2)}.`
          : `Option A applied. Budget cap set to safe minimum at $${budgetResult.budgetCap.toFixed(2)}.`,
      },
      { status: success ? 200 : 207 },
    );
  } catch (error) {
    console.error("OPTION A APPLY FAILURE:", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to apply Option A plan",
      },
      { status: 503 },
    );
  }
}
