import { NextResponse } from "next/server";
import { getAppliances } from "@/lib/services/appliance/appliance.service";
import { DEMO_UID } from "@/lib/shared/constants";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const uid = searchParams.get("uid") ?? DEMO_UID;
  return NextResponse.json(getAppliances(uid));
}
