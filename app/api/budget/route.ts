import { NextResponse } from "next/server";
import { BudgetService } from "@/lib/services/budget/budget.service";

// Update Monthly Cap 
export async function PATCH(request: Request) {
  const { user_id, budget_cap } = await request.json();
  const updated = await BudgetService.updateMonthlyCap(user_id, budget_cap);
  return NextResponse.json(updated);
}

// Get Budget Details 
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = Number(searchParams.get("user_id"));
  const budget = await BudgetService.getBudget(userId);
  return NextResponse.json(budget);
}