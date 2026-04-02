import { NextResponse } from "next/server";
import {
  extractErrorMessage,
  fetchService,
  readJsonBody,
} from "@/lib/clients/service-discovery";

/**
 * GET /api/rate/sync
 * Proxies the sync request to the Rate Flask microservice.
 * The Flask service handles the actual data.gov.sg fetch and DB upsert.
 */
export async function GET() {
  try {
    const response = await fetchService("rate", "/api/rate/sync");
    const payload = await readJsonBody<Record<string, unknown>>(response);

    if (!response.ok) {
      return NextResponse.json(
        {
          success: false,
          error: extractErrorMessage(
            payload,
            `Rate sync service returned HTTP ${response.status}`,
          ),
        },
        { status: response.status },
      );
    }

    return NextResponse.json(payload ?? { success: true });
  } catch (error) {
    console.error("RATE SYNC PROXY FAILURE:", error);
    return NextResponse.json(
      { success: false, error: "Rate sync microservice is unreachable" },
      { status: 503 }
    );
  }
}
