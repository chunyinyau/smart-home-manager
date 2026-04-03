import { NextResponse } from "next/server";
import {
  extractErrorMessage,
  fetchService,
  readJsonBody,
} from "@/lib/clients/service-discovery";

export async function GET() {
  try {
    const response = await fetchService("calculatebill", "/api/calculatebill/state");
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

    return NextResponse.json(payload ?? { success: true, data: {} });
  } catch (error) {
    console.error("CALCULATEBILL STATE FAILURE:", error);
    return NextResponse.json(
      {
        success: false,
        error: "CalculateBill service is currently unreachable",
      },
      { status: 503 },
    );
  }
}
