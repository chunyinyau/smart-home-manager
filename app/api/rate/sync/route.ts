import { NextResponse } from "next/server";

/**
 * GET /api/rate/sync
 * Proxies the sync request to the Rate Flask microservice.
 * The Flask service handles the actual data.gov.sg fetch and DB upsert.
 */
export async function GET() {
  try {
    const response = await fetch("http://127.0.0.1:5001/api/rate/sync", {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Flask sync endpoint returned ${response.status}`);
    }

    const data = await response.json();
    return NextResponse.json(data);

  } catch (error) {
    console.error("❌ RATE SYNC PROXY FAILURE:", error);
    return NextResponse.json(
      { success: false, error: "Rate sync microservice is unreachable" },
      { status: 503 }
    );
  }
}
