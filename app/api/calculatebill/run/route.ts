import { NextResponse } from "next/server";
import {
  extractErrorMessage,
  fetchService,
  readJsonBody,
} from "@/lib/clients/service-discovery";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const response = await fetchService("calculatebill", "/api/calculatebill/run", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      timeoutMs: 12000,
    });

    const payload = await readJsonBody<Record<string, unknown>>(response);

    if (!response.ok) {
      return NextResponse.json(
        {
          success: false,
          error: extractErrorMessage(
            payload,
            `CalculateBill service returned HTTP ${response.status}`,
          ),
        },
        { status: response.status },
      );
    }

    return NextResponse.json(payload ?? { success: true });
  } catch (error) {
    console.error("CALCULATEBILL RUN FAILURE:", error);
    return NextResponse.json(
      {
        success: false,
        error: "CalculateBill service is currently unreachable",
      },
      { status: 503 },
    );
  }
}
