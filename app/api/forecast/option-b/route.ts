import { NextResponse } from "next/server";
import { DEMO_UID } from "@/lib/shared/constants";
import { requestChange } from "@/lib/services/request-change/request-change.service";
import { getForecastRecommendation } from "@/lib/services/forecast/forecast.service";
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

type OptionBActionInput = {
  applianceId?: string;
  name?: string;
  durationMinutes?: number;
};

type OptionBRequestPayload = {
  uid?: string;
  userId?: number;
  budgetCap?: number;
  maxBudgetCap?: number;
  actions?: OptionBActionInput[];
};

type RecommendationSnapshot = {
  currentRiskLevel?: string;
  predictedRiskLevel?: string;
  currentProjectedCost?: number;
  projectedCostAfterPlan?: number;
  target?: {
    safeThresholdRatio?: number;
    targetSafetyThresholdRatio?: number;
    nearestFeasibleBudgetCap?: number;
    met?: boolean;
    metSafetyNet?: boolean;
  };
};

const OPTION_B_STABILITY_BUFFER_SGD = 1.0;
const OPTION_B_STABILITY_RATIO_DELTA = 0.015;

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

function parseNonNegativeAmount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  if (value < 0) {
    return null;
  }

  return Number(value.toFixed(2));
}

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

function isSafeRecommendation(recommendation: RecommendationSnapshot | null): boolean {
  if (!recommendation) {
    return false;
  }

  const currentRisk = String(recommendation.currentRiskLevel ?? "").toUpperCase();
  const predictedRisk = String(recommendation.predictedRiskLevel ?? "").toUpperCase();
  const target = recommendation.target ?? {};

  return currentRisk === "SAFE" && predictedRisk === "SAFE" && target.metSafetyNet !== false;
}

function deriveStabilizedCap(recommendation: RecommendationSnapshot | null): number | null {
  if (!recommendation) {
    return null;
  }

  const projectedCostAfterPlan = parseFiniteNumber(recommendation.projectedCostAfterPlan);
  const currentProjectedCost = parseFiniteNumber(recommendation.currentProjectedCost);
  const projectedCost =
    (projectedCostAfterPlan !== null && projectedCostAfterPlan > 0
      ? projectedCostAfterPlan
      : null) ??
    (currentProjectedCost !== null && currentProjectedCost > 0 ? currentProjectedCost : null);

  if (projectedCost === null) {
    return null;
  }

  const target = recommendation.target ?? {};
  const safeThresholdRatio = parseFiniteNumber(target.safeThresholdRatio) ?? 0.85;
  const targetSafetyThresholdRatio = parseFiniteNumber(target.targetSafetyThresholdRatio);

  const baseRatio =
    targetSafetyThresholdRatio !== null && targetSafetyThresholdRatio > 0
      ? targetSafetyThresholdRatio
      : safeThresholdRatio;
  const stabilityRatio = Math.max(
    0.7,
    Math.min(baseRatio, safeThresholdRatio - OPTION_B_STABILITY_RATIO_DELTA),
  );

  const capFromProjection =
    (projectedCost + OPTION_B_STABILITY_BUFFER_SGD) /
    (stabilityRatio > 0 ? stabilityRatio : 0.85);

  const nearestFeasibleCap = parseFiniteNumber(target.nearestFeasibleBudgetCap) ?? 0;
  return Number(Math.max(capFromProjection, nearestFeasibleCap).toFixed(2));
}

function normalizeActions(actions: OptionBActionInput[] | undefined): Array<{
  applianceId: string;
  name: string;
  durationMinutes: number;
}> {
  if (!Array.isArray(actions)) {
    return [];
  }

  const unique = new Map<string, { applianceId: string; name: string; durationMinutes: number }>();
  for (const action of actions) {
    const applianceId = typeof action?.applianceId === "string" ? action.applianceId.trim() : "";
    if (!applianceId) {
      continue;
    }

    const durationRaw = typeof action?.durationMinutes === "number" ? action.durationMinutes : NaN;
    const durationMinutes = Number.isFinite(durationRaw) && durationRaw > 0
      ? Math.max(1, Math.round(durationRaw))
      : 60;

    const name = typeof action?.name === "string" && action.name.trim().length > 0
      ? action.name.trim()
      : applianceId;

    unique.set(applianceId, {
      applianceId,
      name,
      durationMinutes,
    });
  }

  return Array.from(unique.values());
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

async function getCurrentBudgetCap(userId: number): Promise<number | null> {
  await ensureBudgetExists(userId);

  const response = await fetchService("budget", `/api/budget/${userId}`, {
    timeoutMs: 15000,
  });
  const payload = await readJsonBody<BudgetResponsePayload>(response);

  if (!response.ok || payload?.success === false) {
    throw new Error(
      extractErrorMessage(payload, `Budget fetch failed with HTTP ${response.status}`),
    );
  }

  return parseNonNegativeAmount(payload?.data?.budget_cap);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as OptionBRequestPayload;

    const uid = typeof body.uid === "string" && body.uid.trim().length > 0
      ? body.uid.trim()
      : DEMO_UID;

    const userId = parsePositiveInteger(body.userId) ?? 1;
    const budgetCap = parsePositiveAmount(body.budgetCap);
    const maxBudgetCap = parsePositiveAmount(body.maxBudgetCap);
    if (budgetCap === null) {
      return NextResponse.json(
        { success: false, error: "budgetCap must be a positive number." },
        { status: 400 },
      );
    }

    const actions = normalizeActions(body.actions);
    if (actions.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "actions must include at least one appliance with a duration.",
        },
        { status: 400 },
      );
    }

    const previousBudgetCap = await getCurrentBudgetCap(userId).catch(() => null);
    const budgetResult = await persistBudgetCap(userId, budgetCap);

    const applied: Array<{
      applianceId: string;
      name: string;
      durationMinutes: number;
      confirmationText?: string;
    }> = [];
    const failed: Array<{
      applianceId: string;
      name: string;
      durationMinutes: number;
      error: string;
    }> = [];

    for (const action of actions) {
      try {
        const result = await requestChange({
          uid,
          aid: action.applianceId,
          targetState: "OFF",
          durationMinutes: action.durationMinutes,
        });

        if (typeof result?.error === "string" && result.error.trim().length > 0) {
          throw new Error(result.error);
        }

        const changedAppliances = Array.isArray(result?.changed_appliances)
          ? result.changed_appliances
          : [];
        if (changedAppliances.length === 0) {
          throw new Error("No appliance state change was applied");
        }

        applied.push({
          applianceId: action.applianceId,
          name: action.name,
          durationMinutes: action.durationMinutes,
          confirmationText:
            typeof result?.confirmation_text === "string"
              ? result.confirmation_text
              : undefined,
        });
      } catch (error) {
        failed.push({
          applianceId: action.applianceId,
          name: action.name,
          durationMinutes: action.durationMinutes,
          error: error instanceof Error ? error.message : "Failed to apply appliance action",
        });
      }
    }

    if (applied.length === 0) {
      if (previousBudgetCap !== null) {
        await persistBudgetCap(userId, previousBudgetCap);
      }

      return NextResponse.json(
        {
          success: false,
          option: "option_b_lean_mitigation",
          uid,
          budget: {
            updated: true,
            userId,
            budgetCap: previousBudgetCap,
            rolledBack: true,
          },
          actions: {
            requestedCount: actions.length,
            appliedCount: 0,
            failedCount: failed.length,
            applied,
            failed,
          },
          message: "Option B cancelled because no mitigation action was applied. Budget cap was restored.",
        },
        { status: 409 },
      );
    }

    let recommendationAfter = await getForecastRecommendation(uid).catch(() => null) as RecommendationSnapshot | null;
    let stabilizedBudgetCap = budgetResult.budgetCap;
    let safeguard: {
      applied: boolean;
      reason?: string;
      stabilizedCap?: number;
      maxBudgetCap?: number | null;
      rolledBack?: boolean;
    } = {
      applied: false,
      maxBudgetCap,
    };

    const needsStabilization = !isSafeRecommendation(recommendationAfter);
    const stabilizedCapCandidate = deriveStabilizedCap(recommendationAfter);
    if (
      needsStabilization &&
      stabilizedCapCandidate !== null &&
      stabilizedCapCandidate > stabilizedBudgetCap
    ) {
      if (maxBudgetCap !== null && stabilizedCapCandidate > maxBudgetCap) {
        if (previousBudgetCap !== null) {
          await persistBudgetCap(userId, previousBudgetCap);
        }

        return NextResponse.json(
          {
            success: false,
            option: "option_b_lean_mitigation",
            uid,
            budget: {
              updated: true,
              userId,
              budgetCap: previousBudgetCap,
              rolledBack: true,
            },
            actions: {
              requestedCount: actions.length,
              appliedCount: applied.length,
              failedCount: failed.length,
              applied,
              failed,
            },
            safeguard: {
              applied: false,
              reason: "stability-cap-exceeds-max-budget-cap",
              stabilizedCap: stabilizedCapCandidate,
              maxBudgetCap,
              rolledBack: true,
            },
            recommendationAfter,
            message:
              "Option B would rebound to HIGH with this cap. We restored the previous cap to prevent unstable budget risk. Use Option A or choose a higher cap.",
          },
          { status: 409 },
        );
      }

      const stabilizedBudgetResult = await persistBudgetCap(userId, stabilizedCapCandidate);
      stabilizedBudgetCap = stabilizedBudgetResult.budgetCap;
      safeguard = {
        applied: true,
        reason: "stability-cap-adjustment",
        stabilizedCap: stabilizedBudgetCap,
        maxBudgetCap,
      };
      recommendationAfter = await getForecastRecommendation(uid).catch(() => recommendationAfter) as RecommendationSnapshot | null;
    }

    const success = failed.length === 0;
    const message = success
      ? safeguard.applied
        ? `Option B applied with safeguard. Budget cap adjusted to $${stabilizedBudgetCap.toFixed(2)} and ${applied.length} appliance action(s) applied.`
        : `Option B applied. Budget cap set to $${stabilizedBudgetCap.toFixed(2)} and ${applied.length} appliance action(s) applied.`
      : safeguard.applied
        ? `Option B partially applied with safeguard. Budget cap adjusted to $${stabilizedBudgetCap.toFixed(2)}; ${applied.length} action(s) applied and ${failed.length} failed.`
        : `Option B partially applied. Budget cap set to $${stabilizedBudgetCap.toFixed(2)}; ${applied.length} action(s) applied and ${failed.length} failed.`;

    return NextResponse.json(
      {
        success,
        option: "option_b_lean_mitigation",
        uid,
        budget: {
          updated: true,
          userId: budgetResult.userId,
          budgetCap: stabilizedBudgetCap,
        },
        safeguard,
        actions: {
          requestedCount: actions.length,
          appliedCount: applied.length,
          failedCount: failed.length,
          applied,
          failed,
        },
        recommendationAfter,
        message,
      },
      { status: success ? 200 : 207 },
    );
  } catch (error) {
    console.error("OPTION B APPLY FAILURE:", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to apply Option B plan",
      },
      { status: 503 },
    );
  }
}
