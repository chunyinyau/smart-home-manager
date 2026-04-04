import { NextResponse } from "next/server";
import { changeApplianceState } from "@/lib/services/change-appliance-state/change-appliance-state.service";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as
      | {
          uid?: string;
          aid?: string;
          targetState?: "OFF" | "ON";
        }
      | null;

    const result = await changeApplianceState({
      uid: body?.uid,
      aid: body?.aid,
      targetState: body?.targetState,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("CHANGE APPLIANCE STATE FAILURE:", error);
    return NextResponse.json(
      { error: "Change appliance state composite service is currently unreachable" },
      { status: 503 },
    );
  }
}
