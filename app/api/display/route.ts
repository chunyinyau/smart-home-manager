import { NextResponse } from "next/server";
import {
  extractErrorMessage,
  fetchService,
  readJsonBody,
} from "@/lib/clients/service-discovery";
import { DEMO_UID } from "@/lib/shared/constants";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const uid = searchParams.get("uid") || DEMO_UID;
    const profile_id = searchParams.get("profile_id") || "1";

    const response = await fetchService(
      "display",
      `/api/display?uid=${uid}&profile_id=${profile_id}`,
      {
        timeoutMs: 12000,
      },
    );
    const payload = await readJsonBody<Record<string, unknown>>(response);

    if (!response.ok) {
      return NextResponse.json(
        {
          error: extractErrorMessage(
            payload,
            `Display service returned HTTP ${response.status}`,
          ),
        },
        { status: response.status },
      );
    }

    return NextResponse.json(payload ?? { success: true });
  } catch (error) {
    console.error("❌ DISPLAY AGGREGATION FAILURE:", error);
    return NextResponse.json(
      { error: "Display microservice is currently unreachable" },
      { status: 503 },
    );
  }
}
