import { NextResponse } from "next/server";
import { getForecast } from "@/lib/services/forecast/forecast.service";
import { DEMO_UID } from "@/lib/shared/constants";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const uid =
      searchParams.get("uid") ??
      searchParams.get("user_id") ??
      DEMO_UID;
    const forecast = await getForecast(uid);

    return NextResponse.json(forecast);
  } catch (error) {
    console.error("FORECASTBILL FAILURE:", error);
    return NextResponse.json(
      { error: "ForecastBill service is currently unreachable" },
      { status: 503 },
    );
  }
}
