import { NextResponse } from "next/server";
import { getForecast } from "@/lib/services/forecast/forecast.service";
import { DEMO_UID } from "@/lib/shared/constants";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const uid = searchParams.get("uid") ?? DEMO_UID;
  const forecast = await getForecast(uid);

  if (!forecast) {
    return NextResponse.json({ error: "Profile not found." }, { status: 404 });
  }

  return NextResponse.json(forecast);
}
