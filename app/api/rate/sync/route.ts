import { NextResponse } from "next/server";
import { prisma } from "@/lib/clients/prisma";

const DATA_GOV_URL =
  "https://data.gov.sg/api/action/datastore_search?resource_id=d_61eac3cdb086814af485dcc682b75ae9";

const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// Converts a JS Date to the data.gov.sg column key format, e.g. "2026Mar"
function getDataGovKey(date: Date): string {
  return `${date.getFullYear()}${MONTH_ABBR[date.getMonth()]}`;
}

// Converts a JS Date to our DB storage format, e.g. "2026-03"
function getMonthYear(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${date.getFullYear()}-${month}`;
}

export async function GET() {
  try {
    const today = new Date();
    const dataGovKey = getDataGovKey(today);   // e.g. "2026Mar"
    const monthYear = getMonthYear(today);      // e.g. "2026-03"

    // Fetch all tariff rows from data.gov.sg
    const response = await fetch(DATA_GOV_URL);
    const json = await response.json();

    // Find the residential household row specifically
    const domesticRow = json.result.records.find(
      (r: { DataSeries: string }) =>
        r.DataSeries === "Low Tension Supplies - Domestic"
    );

    if (!domesticRow || !domesticRow[dataGovKey]) {
      return NextResponse.json(
        { success: false, error: `No rate found for ${dataGovKey} in data.gov.sg` },
        { status: 404 }
      );
    }

    // data.gov.sg returns cents (e.g. "26.71"), convert to SGD decimal (0.2671)
    const rateInCents = parseFloat(domesticRow[dataGovKey]);
    const ratePerKwh = rateInCents / 100;

    // Upsert: update if month already exists, create if it doesn't
    const existingRate = await prisma.rate.findFirst({
      where: { month_year: monthYear },
    });

    let rate;
    if (existingRate) {
      rate = await prisma.rate.update({
        where: { rate_id: existingRate.rate_id },
        data: { rate_per_kwh: ratePerKwh },
      });
    } else {
      rate = await prisma.rate.create({
        data: {
          rate_per_kwh: ratePerKwh,
          month_year: monthYear,
        },
      });
    }

    return NextResponse.json({
      success: true,
      message: `Rate synced for ${monthYear}`,
      data: { ...rate, rate_per_kwh: Number(rate.rate_per_kwh) },
    });

  } catch (error) {
    console.error("RATE SYNC ERROR:", error);
    return NextResponse.json(
      { success: false, error: "Failed to sync rate from data.gov.sg" },
      { status: 500 }
    );
  }
}
