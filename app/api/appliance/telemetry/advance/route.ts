import { NextResponse } from "next/server";
import {
  extractErrorMessage,
  fetchService,
  readJsonBody,
} from "@/lib/clients/service-discovery";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const response = await fetchService("appliance", "/api/appliance/telemetry/advance", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const payload = await readJsonBody<Record<string, unknown>>(response);

    if (!response.ok) {
      return NextResponse.json(
        {
          error: extractErrorMessage(
            payload,
            `Telemetry service returned HTTP ${response.status}`,
          ),
        },
        { status: response.status },
      );
    }

    return NextResponse.json(payload ?? {});
  } catch (error) {
    console.error("TELEMETRY ADVANCE FAILURE:", error);
    return NextResponse.json(
      { error: "Telemetry service is currently unreachable" },
      { status: 503 },
    );
  }
}
