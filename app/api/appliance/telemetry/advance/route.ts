import { NextResponse } from "next/server";
import { getApplianceServiceUrl } from "@/lib/shared/service-urls";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const response = await fetch(`${getApplianceServiceUrl()}/api/appliance/telemetry/advance`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Telemetry service error: ${response.status}`);
    }

    return NextResponse.json(await response.json());
  } catch (error) {
    console.error("❌ TELEMETRY ADVANCE FAILURE:", error);
    return NextResponse.json(
      { error: "Telemetry service is currently unreachable" },
      { status: 503 },
    );
  }
}
