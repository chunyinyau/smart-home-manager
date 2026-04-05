import { NextResponse } from "next/server";
import {
  extractErrorMessage,
  fetchService,
  readJsonBody,
} from "@/lib/clients/service-discovery";

function parseUserId(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ user_id: string }> },
) {
  try {
    const { user_id: rawUserId } = await params;
    const userId = parseUserId(rawUserId);

    if (userId === null) {
      return NextResponse.json(
        { success: false, error: "user_id must be a positive integer." },
        { status: 400 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const response = await fetchService("updatebudget", `/api/updatebudget/${userId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      timeoutMs: 15000,
    });

    const payload = await readJsonBody<Record<string, unknown>>(response);

    if (!response.ok) {
      return NextResponse.json(
        {
          success: false,
          error: extractErrorMessage(
            payload,
            `UpdateBudget service returned HTTP ${response.status}`,
          ),
        },
        { status: response.status },
      );
    }

    return NextResponse.json(payload ?? { success: true });
  } catch (error) {
    console.error("UPDATEBUDGET FAILURE:", error);
    return NextResponse.json(
      {
        success: false,
        error: "UpdateBudget composite service is currently unreachable",
      },
      { status: 503 },
    );
  }
}
