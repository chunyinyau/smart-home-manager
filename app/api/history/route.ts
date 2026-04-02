import { NextResponse } from "next/server";
import { getHistory } from "@/lib/services/history/history.service";
import { DEMO_UID } from "@/lib/shared/constants";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const uid = searchParams.get("user_id") ?? searchParams.get("uid") ?? DEMO_UID;
  return NextResponse.json(getHistory(uid));
}
