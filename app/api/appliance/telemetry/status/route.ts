import { NextResponse } from "next/server";

const TELEMETRY_SERVICE_URL = "http://127.0.0.1:5002";

export async function GET() {
  try {
    const response = await fetch(`${TELEMETRY_SERVICE_URL}/api/appliance/telemetry/status`, {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Telemetry service error: ${response.status}`);
    }

    return NextResponse.json(await response.json());
  } catch (error) {
    console.error("TELEMETRY STATUS FAILURE:", error);
    return NextResponse.json(
      { error: "Telemetry service is currently unreachable" },
      { status: 503 },
    );
  }
}
