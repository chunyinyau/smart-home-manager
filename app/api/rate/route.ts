import { NextResponse } from "next/server";
import { getRate } from "@/lib/services/rate/rate.service";

export async function GET() {
  return NextResponse.json(getRate());
}
