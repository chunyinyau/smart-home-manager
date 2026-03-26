import { prisma } from "@/lib/clients/prisma";

export async function getCurrentRate() {
  const today = new Date();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const monthYear = `${today.getFullYear()}-${month}`; // e.g. "2026-03"

  const rate = await prisma.rate.findFirst({
    where: { month_year: monthYear },
  });

  if (!rate) {
    throw new Error("No active SP tariff rate found in the database.");
  }

  return {
    ...rate,
    cents_per_kwh: Number(rate.cents_per_kwh),
  };
}
