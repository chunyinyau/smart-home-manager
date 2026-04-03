/**
 * Rate Service Client
 *
 * In the new microservice architecture, the Rate database logic lives
 * inside rate-service/ (Python Flask + MySQL Docker container).
 *
 * This file is kept as a thin fetch wrapper so existing frontend
 * components can continue importing from "@/lib/services/rate".
 */
import {
  extractErrorMessage,
  fetchService,
  readJsonBody,
} from "@/lib/clients/service-discovery";

interface RateServiceResponse {
  success?: boolean;
  error?: string;
  message?: string;
  data?: Array<{
    rate_id: number;
    cents_per_kwh: number | string;
    month_year: string;
  }>;
}

export async function getCurrentRate() {
  const res = await fetchService("rate", "/api/rate");
  const json = await readJsonBody<RateServiceResponse>(res);

  if (!res.ok) {
    throw new Error(
      extractErrorMessage(json, `Rate microservice returned HTTP ${res.status}`),
    );
  }

  if (!json?.success || !Array.isArray(json.data) || json.data.length === 0) {
    throw new Error("No active rate found");
  }

  const rate = json.data[0];
  return {
    rate_id: rate.rate_id,
    cents_per_kwh: Number(rate.cents_per_kwh),
    month_year: rate.month_year,
  };
}

export async function getRate() {
  const rate = await getCurrentRate();
  return {
    ...rate,
    pricePerKwh: rate.cents_per_kwh / 100,
  };
}
