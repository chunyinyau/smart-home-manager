/**
 * Rate Repository — DEPRECATED
 *
 * This file previously held in-memory mock data.
 * All rate data now lives in the MySQL database managed by
 * the rate-service Docker container (rate-service/app.py).
 *
 * Use lib/services/rate/rate.service.ts to fetch rate data.
 */

export {}; // Keep the file to avoid import errors during migration
