import { NextResponse } from "next/server";
import { handleTelegramIntent } from "@/lib/orchestrator/telegram-orchestrator";
import { parseIntent } from "@/lib/orchestrator/intent-parser";

export async function POST(request: Request) {
  const body = await request.json();
  const intent = parseIntent(String(body.intent ?? ""));

  if (!intent) {
    return NextResponse.json(
      { error: "Unsupported or missing intent." },
      { status: 400 },
    );
  }

  const result = await handleTelegramIntent(intent, body.params ?? {});
  return NextResponse.json(result);
}
