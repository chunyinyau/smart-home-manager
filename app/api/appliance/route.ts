import { NextResponse } from "next/server";
import { getAppliances } from "@/lib/services/appliance/appliance.service";
import { DEMO_UID } from "@/lib/shared/constants";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const uid = searchParams.get("uid") ?? DEMO_UID;
    const appliances = await getAppliances(uid);
    return NextResponse.json(appliances);
  } catch (error) {
    console.error("APPLIANCE LIST FAILURE:", error);
    return NextResponse.json(
      { error: "Appliance microservice is currently unreachable" },
      { status: 503 },
    );
  }
}
