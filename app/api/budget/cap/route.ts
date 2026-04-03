import { NextResponse } from "next/server";
import {
  extractErrorMessage,
  fetchService,
  readJsonBody,
} from "@/lib/clients/service-discovery";

const DEFAULT_BUDGET_USER_ID = Number(process.env.DEFAULT_BUDGET_USER_ID ?? "1");

function parseUserId(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function getDefaultUserId(): number | null {
  if (!Number.isSafeInteger(DEFAULT_BUDGET_USER_ID) || DEFAULT_BUDGET_USER_ID <= 0) {
    return null;
  }

  return DEFAULT_BUDGET_USER_ID;
}

function parseBudgetCap(value: unknown): number | null {
  const cap = Number(value);
  if (!Number.isFinite(cap) || cap <= 0) {
    return null;
  }

  return Number(cap.toFixed(2));
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as
      | Record<string, unknown>
      | null;

    if (!body) {
      return NextResponse.json({ error: "Request body is required." }, { status: 400 });
    }

    const hasExplicitUserId = Object.prototype.hasOwnProperty.call(body, "user_id");
    const hasUidAlias = Object.prototype.hasOwnProperty.call(body, "uid");

    let userId: number | null;
    if (hasExplicitUserId) {
      userId = parseUserId(body.user_id);
      if (userId === null) {
        return NextResponse.json({ error: "user_id must be a positive integer." }, { status: 400 });
      }
    } else if (hasUidAlias) {
      userId = parseUserId(body.uid) ?? getDefaultUserId();
    } else {
      userId = getDefaultUserId();
    }

    if (userId === null) {
      return NextResponse.json(
        { error: "DEFAULT_BUDGET_USER_ID must be configured as a positive integer." },
        { status: 500 },
      );
    }

    const monthlyCap = parseBudgetCap(body.monthlyCap ?? body.budget_cap);
    if (monthlyCap === null) {
      return NextResponse.json(
        { error: "monthlyCap must be a positive number." },
        { status: 400 },
      );
    }

    const response = await fetchService("budget", `/api/budget/${userId}/cap`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ budget_cap: monthlyCap }),
    });
    const payload = await readJsonBody<Record<string, unknown>>(response);

    if (!response.ok) {
      return NextResponse.json(
        {
          error: extractErrorMessage(
            payload,
            `Budget service returned HTTP ${response.status}`,
          ),
        },
        { status: response.status },
      );
    }

    return NextResponse.json(payload ?? { success: true });
  } catch (error) {
    console.error("❌ BUDGET CAP FAILURE:", error);
    return NextResponse.json(
      { error: "Budget microservice is currently unreachable" },
      { status: 503 },
    );
  }
}
