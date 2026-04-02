/**
 * Rate Service Client
 *
 * In the new microservice architecture, the Rate database logic lives
 * inside rate-service/ (Python Flask + MySQL Docker container).
 *
 * This file is kept as a thin fetch wrapper so existing frontend
 * components can continue importing from "@/lib/services/rate".
 */

const RATE_SERVICE_URL = "http://127.0.0.1:5001";

export async function getCurrentRate() {
  const res = await fetch(`${RATE_SERVICE_URL}/api/rate`, {
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error("Rate microservice returned an error");
  }

  const json = await res.json();

  if (!json.success || !json.data || json.data.length === 0) {
    throw new Error("No active rate found");
  }

  const rate = json.data[0];
  return {
    rate_id: rate.rate_id,
    cents_per_kwh: Number(rate.cents_per_kwh),
    month_year: rate.month_year,
  };
}
