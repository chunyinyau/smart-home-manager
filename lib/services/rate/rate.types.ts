/**
 * Rate Types
 *
 * Shared type definitions for rate data returned by the
 * Rate Flask microservice.
 */
export interface RateRecord {
  rate_id: number;
  cents_per_kwh: number;
  month_year: string;
}
