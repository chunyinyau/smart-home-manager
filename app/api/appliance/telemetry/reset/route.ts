import { NextResponse } from "next/server";
import { getApplianceServiceUrl } from "@/lib/shared/service-urls";

export async function POST() {
  try {
    const response = await fetch(`${getApplianceServiceUrl()}/api/appliance/telemetry/reset`, {
      method: "POST",
    });

    if (!response.ok) {
      throw new Error(`Telemetry service error: ${response.status}`);
    }

    return NextResponse.json(await response.json());
  } catch (error) {
    console.error("❌ TELEMETRY RESET FAILURE:", error);
    return NextResponse.json(
      { error: "Telemetry service is currently unreachable" },
      { status: 503 },
    );
  }
}
