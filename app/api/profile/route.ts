import { NextResponse } from "next/server";
import { getUserProfile } from "@/lib/services/profile/profile.service";
import { DEMO_UID } from "@/lib/shared/constants";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const uid = searchParams.get("uid") ?? DEMO_UID;
  return NextResponse.json(getUserProfile(uid));
}
