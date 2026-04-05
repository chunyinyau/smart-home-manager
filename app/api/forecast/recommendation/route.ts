import { NextResponse } from "next/server";
import { getForecastRecommendation } from "@/lib/services/forecast/forecast.service";
import { DEMO_UID } from "@/lib/shared/constants";

const RECOMMENDATION_CACHE_TTL_MS = 10_000;
const recommendationCache = new Map<string, { expiresAt: number; payload: unknown }>();

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const uid =
      searchParams.get("uid") ??
      searchParams.get("user_id") ??
      DEMO_UID;

    const cached = recommendationCache.get(uid);
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(cached.payload);
    }

    const recommendation = await getForecastRecommendation(uid);
    recommendationCache.set(uid, {
      payload: recommendation,
      expiresAt: Date.now() + RECOMMENDATION_CACHE_TTL_MS,
    });

    return NextResponse.json(recommendation);
  } catch (error) {
    console.error("FORECAST RECOMMENDATION FAILURE:", error);
    return NextResponse.json(
      { error: "Forecast recommendation service is currently unreachable" },
      { status: 503 },
    );
  }
}
