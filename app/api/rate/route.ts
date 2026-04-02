import { NextResponse } from "next/server";
import {
  extractErrorMessage,
  fetchService,
  readJsonBody,
} from "@/lib/clients/service-discovery";

export async function GET() {
  try {
    const response = await fetchService("rate", "/api/rate");
    const payload = await readJsonBody<Record<string, unknown>>(response);

    if (!response.ok) {
      return NextResponse.json(
        {
          success: false,
          error: extractErrorMessage(
            payload,
            `Rate service returned HTTP ${response.status}`,
          ),
        },
        { status: response.status },
      );
    }

    return NextResponse.json(payload ?? { success: true, data: [] });
  } catch (error) {
    if (error instanceof Error) {
      console.error("❌ RATE PROXY FAILURE:", error.message);
    } else {
      console.error("❌ RATE PROXY FAILURE: Unknown Error", error);
    }

    return NextResponse.json(
      {
        success: false,
        error: "Rate microservice is currently unreachable",
      },
      { status: 503 },
    );
  }
}
