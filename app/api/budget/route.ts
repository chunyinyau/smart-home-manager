import { NextResponse } from "next/server";
import { getBudgetStatus } from "@/lib/services/budget/budget.service";
import { DEMO_UID } from "@/lib/shared/constants";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const uid = searchParams.get("uid") ?? DEMO_UID;
  return NextResponse.json(getBudgetStatus(uid));
}
