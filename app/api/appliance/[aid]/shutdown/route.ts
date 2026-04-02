import { NextResponse } from "next/server";
import { shutdownAppliance } from "@/lib/services/appliance/appliance.service";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ aid: string }> },
) {
  try {
    const { aid } = await params;
    const appliance = await shutdownAppliance(aid);
    if (!appliance) {
      return NextResponse.json({ error: "Appliance not found." }, { status: 404 });
    }
    return NextResponse.json(appliance);
  } catch (error) {
    console.error("❌ APPLIANCE SHUTDOWN FAILURE:", error);
    return NextResponse.json(
      { error: "Appliance microservice is currently unreachable" },
      { status: 503 },
    );
  }
}
