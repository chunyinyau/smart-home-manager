import { budgetPrisma } from "@/lib/clients/budget";

export const BudgetService = {
  // Pure Retrieval 
  async getBudget(userId: number) {
    return await budgetPrisma.budget.findUnique({
      where: { user_id: userId }
    });
  },

  // Pure Update of the monthly cap 
  async updateMonthlyCap(userId: number, budgetCap: number) {
    return await budgetPrisma.budget.update({
      where: { user_id: userId },
      data: { budget_cap: budgetCap }
    });
  },

  // Accepting the "Dump" from CalculateBill 
  async updateCumulativeBill(userId: number, newTotal: number) {
    return await budgetPrisma.budget.update({
      where: { user_id: userId },
      data: { cum_bill: newTotal }
    });
  }
};