type ServiceKey =
  | "rate"
  | "appliance"
  | "bill"
  | "budget"
  | "history"
  | "forecastbill"
  | "display"
  | "calculatebill"
  | "requestchange";

interface ServiceConfig {
  envVars: string[];
  dockerHost: string;
  port: number;
}

const SERVICE_CONFIG: Record<ServiceKey, ServiceConfig> = {
  rate: {
    envVars: ["RATE_SERVICE_BASE_URL", "RATE_SERVICE_URL"],
    dockerHost: "rate_service",
    port: 5007,
  },
  appliance: {
    envVars: ["APPLIANCE_SERVICE_BASE_URL", "APPLIANCE_SERVICE_URL"],
    dockerHost: "appliance_service",
    port: 5002,
  },
  bill: {
    envVars: ["BILL_SERVICE_BASE_URL", "BILL_SERVICE_URL"],
    dockerHost: "bill_service",
    port: 5003,
  },
  budget: {
    envVars: ["BUDGET_SERVICE_BASE_URL", "BUDGET_SERVICE_URL"],
    dockerHost: "budget_service",
    port: 5004,
  },
  history: {
    envVars: ["HISTORY_SERVICE_BASE_URL", "HISTORY_SERVICE_URL"],
    dockerHost: "history_service",
    port: 5005,
  },
  forecastbill: {
    envVars: ["FORECASTBILL_SERVICE_BASE_URL", "FORECASTBILL_SERVICE_URL"],
    dockerHost: "forecastbill_service",
    port: 5009,
  },
  display: {
    envVars: ["DISPLAY_SERVICE_BASE_URL", "DISPLAY_SERVICE_URL"],
    dockerHost: "display_service",
    port: 5006,
  },
  calculatebill: {
    envVars: ["CALCULATEBILL_SERVICE_BASE_URL", "CALCULATEBILL_SERVICE_URL"],
    dockerHost: "calculatebill_service",
    port: 5008,
  },
  requestchange: {
    envVars: [
      "REQUEST_CHANGE_SERVICE_BASE_URL",
      "REQUEST_CHANGE_SERVICE_URL",
    ],
    dockerHost: "request_change_service",
    port: 5011,
  },
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

function parseEnvUrls(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }

  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .map(normalizeBaseUrl);
}

export function getServiceBaseUrls(service: ServiceKey): string[] {
  const config = SERVICE_CONFIG[service];

  const configuredUrls = config.envVars.flatMap((envVar) =>
    parseEnvUrls(process.env[envVar]),
  );

  const fallbackUrls = [
    `http://${config.dockerHost}:${config.port}`,
    `http://host.docker.internal:${config.port}`,
    `http://127.0.0.1:${config.port}`,
    `http://localhost:${config.port}`,
  ].map(normalizeBaseUrl);

  return [...new Set([...configuredUrls, ...fallbackUrls])];
}

interface FetchServiceOptions extends RequestInit {
  timeoutMs?: number;
}

export async function fetchService(
  service: ServiceKey,
  path: string,
  options: FetchServiceOptions = {},
): Promise<Response> {
  const { timeoutMs = 5000, ...requestInit } = options;
  const baseUrls = getServiceBaseUrls(service);

  let lastError: unknown = null;

  for (const baseUrl of baseUrls) {
    const targetUrl = `${baseUrl}${path}`;
    const init: RequestInit = {
      ...requestInit,
      cache: requestInit.cache ?? "no-store",
      signal: requestInit.signal ?? AbortSignal.timeout(timeoutMs),
    };

    try {
      return await fetch(targetUrl, init);
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }

  throw new Error(`Unable to reach ${service} service`);
}

export async function readJsonBody<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export function extractErrorMessage(payload: unknown, fallbackMessage: string): string {
  if (payload && typeof payload === "object") {
    const candidate = payload as Record<string, unknown>;
    const errorValue = candidate.error ?? candidate.message;

    if (typeof errorValue === "string" && errorValue.trim().length > 0) {
      return errorValue;
    }
  }

  return fallbackMessage;
}
