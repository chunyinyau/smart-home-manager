import { NextResponse } from "next/server";
import { getForecastRecommendation } from "@/lib/services/forecast/forecast.service";
import { DEMO_UID } from "@/lib/shared/constants";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const uid =
      searchParams.get("uid") ??
      searchParams.get("user_id") ??
      DEMO_UID;

    const recommendation = await getForecastRecommendation(uid);
    return NextResponse.json(recommendation);
  } catch (error) {
    console.error("FORECAST RECOMMENDATION FAILURE:", error);
    return NextResponse.json(
      { error: "Forecast recommendation service is currently unreachable" },
      { status: 503 },
    );
  }
}
