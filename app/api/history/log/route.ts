import { NextResponse } from "next/server";
import { logHistory } from "@/lib/services/history/history.service";
import { DEMO_UID } from "@/lib/shared/constants";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const uid = body.user_id ?? body.uid ?? DEMO_UID;
    const message =
      typeof body.message === "string" ? body.message.trim() : "";

    if (!message) {
      return NextResponse.json(
        { error: "message is required." },
        { status: 400 },
      );
    }

    const ack = await logHistory(
      uid,
      message,
      typeof body.occurred_at === "string" ? body.occurred_at : undefined,
    );

    return NextResponse.json(ack, { status: 202 });
  } catch (error) {
    console.error("HISTORY LOG FAILURE:", error);
    return NextResponse.json(
      { error: "History microservice is currently unreachable" },
      { status: 503 },
    );
  }
}
