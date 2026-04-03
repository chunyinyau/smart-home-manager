import { NextResponse } from "next/server";
import { getApplianceServiceUrl } from "@/lib/shared/service-urls";

export async function GET() {
  try {
    const response = await fetch(`${getApplianceServiceUrl()}/api/appliance/telemetry/status`, {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Telemetry service error: ${response.status}`);
    }

    return NextResponse.json(await response.json());
  } catch (error) {
    console.error("❌ TELEMETRY STATUS FAILURE:", error);
    return NextResponse.json(
      { error: "Telemetry service is currently unreachable" },
      { status: 503 },
    );
  }
}
