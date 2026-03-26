import { prisma } from "../lib/clients/rate";

async function main() {
  const rate = await prisma.rate.create({
    data: {
      cents_per_kwh: 26.71,
      month_year: '2026-03',
    },
  })
  
  console.log(`Successfully seeded the 2026 Database Rate: ${rate.cents_per_kwh} Cents/kWh`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
