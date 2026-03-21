import { NextResponse } from "next/server";
import { shutdownAppliance } from "@/lib/services/appliance/appliance.service";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ aid: string }> },
) {
  const { aid } = await params;
  const appliance = shutdownAppliance(aid);
  if (!appliance) {
    return NextResponse.json({ error: "Appliance not found." }, { status: 404 });
  }
  return NextResponse.json(appliance);
}
