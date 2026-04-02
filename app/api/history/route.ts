import { NextResponse } from "next/server";
import { getHistory } from "@/lib/services/history/history.service";
import { DEMO_UID } from "@/lib/shared/constants";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const uid = searchParams.get("user_id") ?? searchParams.get("uid") ?? DEMO_UID;
    const history = await getHistory(uid);
    return NextResponse.json(history);
  } catch (error) {
    console.error("HISTORY LIST FAILURE:", error);
    return NextResponse.json(
      { error: "History microservice is currently unreachable" },
      { status: 503 },
    );
  }
}
