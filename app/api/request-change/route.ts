import { NextResponse } from "next/server";
import { requestChange } from "@/lib/services/request-change/request-change.service";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as
      | {
          uid?: string;
          aid?: string;
          targetState?: "OFF" | "ON";
          durationMinutes?: number;
        }
      | null;

    const result = await requestChange({
      uid: body?.uid,
      aid: body?.aid,
      targetState: body?.targetState,
      durationMinutes: body?.durationMinutes,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("REQUEST CHANGE FAILURE:", error);
    return NextResponse.json(
      { error: "Request change composite service is currently unreachable" },
      { status: 503 },
    );
  }
}
