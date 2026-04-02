import { NextResponse } from "next/server";
import { setAppliancePriority } from "@/lib/services/appliance/appliance.service";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ aid: string }> },
) {
  try {
    const { aid } = await params;
    const body = await request.json();
    const priority = Number(body.priority);

    if (!Number.isFinite(priority)) {
      return NextResponse.json(
        { error: "priority must be a number." },
        { status: 400 },
      );
    }

    const appliance = await setAppliancePriority(aid, priority);
    if (!appliance) {
      return NextResponse.json({ error: "Appliance not found." }, { status: 404 });
    }

    return NextResponse.json(appliance);
  } catch (error) {
    console.error("❌ APPLIANCE PRIORITY FAILURE:", error);
    return NextResponse.json(
      { error: "Appliance microservice is currently unreachable" },
      { status: 503 },
    );
  }
}
