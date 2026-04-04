import { NextResponse } from "next/server";
import {
  extractErrorMessage,
  fetchService,
  readJsonBody,
} from "@/lib/clients/service-discovery";

export async function GET() {
  try {
    const response = await fetchService("appliance", "/api/appliance/telemetry/accrual");
    const payload = await readJsonBody<Record<string, unknown>>(response);

    if (!response.ok) {
      return NextResponse.json(
        {
          error: extractErrorMessage(
            payload,
            `Telemetry accrual service returned HTTP ${response.status}`,
          ),
        },
        { status: response.status },
      );
    }

    return NextResponse.json(payload ?? {});
  } catch (error) {
    console.error("TELEMETRY ACCRUAL FAILURE:", error);
    return NextResponse.json(
      { error: "Telemetry accrual service is currently unreachable" },
      { status: 503 },
    );
  }
}
