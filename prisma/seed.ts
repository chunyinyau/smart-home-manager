import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const rate = await prisma.rate.create({
    data: {
      rate_per_kwh: 0.2671,
      month_year: '2026-03',
    },
  })
  
  console.log(`Successfully seeded the 2026 Database Rate: $${rate.rate_per_kwh}/kWh`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
