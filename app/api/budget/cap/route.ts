import { NextResponse } from "next/server";
import { updateMonthlyCap } from "@/lib/services/budget/budget.service";
import { DEMO_UID } from "@/lib/shared/constants";

export async function POST(request: Request) {
  const body = await request.json();
  const uid = body.uid ?? DEMO_UID;
  const monthlyCap = Number(body.monthlyCap);

  if (!Number.isFinite(monthlyCap)) {
    return NextResponse.json({ error: "monthlyCap must be a number." }, { status: 400 });
  }

  const budget = updateMonthlyCap(uid, monthlyCap);
  if (!budget) {
    return NextResponse.json({ error: "Budget not found." }, { status: 404 });
  }

  return NextResponse.json(budget);
}
