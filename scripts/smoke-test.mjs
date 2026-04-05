const DEFAULT_BASE_URL = "http://localhost:3000";
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_BUDGET_USER_ID = "1";
const DEFAULT_HISTORY_USER_ID = "user_demo_001";

function normalizeBaseUrl(url) {
  return url.replace(/\/+$/, "");
}

function resolveBaseUrl(defaultUrl, envKeys) {
  for (const key of envKeys) {
    const raw = process.env[key];
    if (!raw) {
      continue;
    }

    const firstConfiguredUrl = raw
      .split(",")
      .map((value) => value.trim())
      .find((value) => value.length > 0);

    if (firstConfiguredUrl) {
      return normalizeBaseUrl(firstConfiguredUrl);
    }
  }

  return normalizeBaseUrl(defaultUrl);
}

const baseUrl = resolveBaseUrl(DEFAULT_BASE_URL, ["SMOKE_BASE_URL"]);
const publicGatewayBaseUrl = resolveBaseUrl("", [
  "SMOKE_PUBLIC_GATEWAY_BASE_URL",
  "OPENCLAW_PUBLIC_BASE_URL",
]);
const timeoutMs = Number.parseInt(
  process.env.SMOKE_TIMEOUT_MS ?? String(DEFAULT_TIMEOUT_MS),
  10,
);
const budgetUserId = process.env.SMOKE_BUDGET_USER_ID ?? DEFAULT_BUDGET_USER_ID;
const historyUserId = process.env.SMOKE_HISTORY_USER_ID ?? DEFAULT_HISTORY_USER_ID;

const serviceBaseUrls = {
  appliance: resolveBaseUrl("http://localhost:5002", [
    "SMOKE_APPLIANCE_SERVICE_URL",
    "APPLIANCE_SERVICE_BASE_URL",
    "APPLIANCE_SERVICE_URL",
  ]),
  bill: resolveBaseUrl("http://localhost:5003", [
    "SMOKE_BILL_SERVICE_URL",
    "BILL_SERVICE_BASE_URL",
    "BILL_SERVICE_URL",
  ]),
  budget: resolveBaseUrl("http://localhost:5004", [
    "SMOKE_BUDGET_SERVICE_URL",
    "BUDGET_SERVICE_BASE_URL",
    "BUDGET_SERVICE_URL",
  ]),
  history: resolveBaseUrl("http://localhost:5005", [
    "SMOKE_HISTORY_SERVICE_URL",
    "HISTORY_SERVICE_BASE_URL",
    "HISTORY_SERVICE_URL",
  ]),
  rate: resolveBaseUrl("http://localhost:5007", [
    "SMOKE_RATE_SERVICE_URL",
    "RATE_SERVICE_BASE_URL",
    "RATE_SERVICE_URL",
  ]),
  calculatebill: resolveBaseUrl("http://localhost:5008", [
    "SMOKE_CALCULATEBILL_SERVICE_URL",
    "CALCULATEBILL_SERVICE_BASE_URL",
    "CALCULATEBILL_SERVICE_URL",
  ]),
  forecastbill: resolveBaseUrl("http://localhost:5009", [
    "SMOKE_FORECASTBILL_SERVICE_URL",
    "FORECASTBILL_SERVICE_BASE_URL",
    "FORECASTBILL_SERVICE_URL",
  ]),
};

const checks = [
  {
    name: "App Rate Read",
    method: "GET",
    path: "/api/rate",
    baseUrl,
    label: "Next API",
    expectedStatuses: [200],
    toleratedStatuses: [],
  },
  {
    name: "App Rate Sync",
    method: "GET",
    path: "/api/rate/sync",
    baseUrl,
    label: "Next API",
    expectedStatuses: [200],
    toleratedStatuses: [429, 502],
  },
  {
    name: "App Budget Read",
    method: "GET",
    path: `/api/budget?user_id=${encodeURIComponent(budgetUserId)}`,
    baseUrl,
    label: "Next API",
    expectedStatuses: [200],
    toleratedStatuses: [],
  },
  {
    name: "App Telemetry Status",
    method: "GET",
    path: "/api/appliance/telemetry/status",
    baseUrl,
    label: "Next API",
    expectedStatuses: [200],
    toleratedStatuses: [],
  },
  {
    name: "App History Read",
    method: "GET",
    path: `/api/history?user_id=${encodeURIComponent(historyUserId)}`,
    baseUrl,
    label: "Next API",
    expectedStatuses: [200],
    toleratedStatuses: [],
  },
  {
    name: "App Forecast Read",
    method: "GET",
    path: `/api/forecast?uid=${encodeURIComponent(historyUserId)}`,
    baseUrl,
    label: "Next API",
    expectedStatuses: [200],
    toleratedStatuses: [],
  },
  {
    name: "Appliance Service Read",
    method: "GET",
    path: "/api/appliance",
    baseUrl: serviceBaseUrls.appliance,
    label: "appliance-service",
    expectedStatuses: [200],
    toleratedStatuses: [],
  },
  {
    name: "Bill Service Read",
    method: "GET",
    path: "/api/bills",
    baseUrl: serviceBaseUrls.bill,
    label: "bill-service",
    expectedStatuses: [200],
    toleratedStatuses: [],
  },
  {
    name: "Budget Service Read",
    method: "GET",
    path: "/api/budget",
    baseUrl: serviceBaseUrls.budget,
    label: "budget-service",
    expectedStatuses: [200],
    toleratedStatuses: [],
  },
  {
    name: "History Service Read",
    method: "GET",
    path: `/api/history?user_id=${encodeURIComponent(historyUserId)}`,
    baseUrl: serviceBaseUrls.history,
    label: "history-service",
    expectedStatuses: [200],
    toleratedStatuses: [],
  },
  {
    name: "Rate Service Read",
    method: "GET",
    path: "/api/rate",
    baseUrl: serviceBaseUrls.rate,
    label: "rate-service",
    expectedStatuses: [200],
    toleratedStatuses: [],
  },
  {
    name: "CalculateBill Service State",
    method: "GET",
    path: "/api/calculatebill/state",
    baseUrl: serviceBaseUrls.calculatebill,
    label: "calculatebill-service",
    expectedStatuses: [200],
    toleratedStatuses: [],
  },
  {
    name: "ForecastBill Service Read",
    method: "GET",
    path: `/api/forecast?uid=${encodeURIComponent(historyUserId)}`,
    baseUrl: serviceBaseUrls.forecastbill,
    label: "forecastbill-service",
    expectedStatuses: [200],
    toleratedStatuses: [],
  },
];

if (publicGatewayBaseUrl) {
  checks.push(
    {
      name: "Public UpdateBudget Route",
      method: "PUT",
      path: `/updatebudget/api/updatebudget/${encodeURIComponent(budgetUserId)}`,
      baseUrl: publicGatewayBaseUrl,
      label: "public-gateway",
      expectedStatuses: [200],
      toleratedStatuses: [],
      body: { budget_cap: 150, monthlyCap: 150 },
    },
    {
      name: "Public Request Change Route",
      method: "POST",
      path: "/request-change/api/request-change",
      baseUrl: publicGatewayBaseUrl,
      label: "public-gateway",
      expectedStatuses: [200],
      toleratedStatuses: [],
      body: {
        uid: historyUserId,
        target_state: "OFF",
      },
    },
    {
      name: "Public Change Appliance State Route",
      method: "POST",
      path: "/change-appliance-state/api/change-appliance-state",
      baseUrl: publicGatewayBaseUrl,
      label: "public-gateway",
      expectedStatuses: [200],
      toleratedStatuses: [],
      body: {
        uid: historyUserId,
        target_state: "OFF",
      },
    },
  );
}

function getTimeoutSignal(ms) {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(ms);
  }

  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

function parseBody(text) {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function toOneLine(value) {
  if (value === null || value === undefined) {
    return "";
  }

  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.replace(/\s+/g, " ").trim().slice(0, 240);
}

async function runCheck(check) {
  const started = Date.now();
  const url = `${check.baseUrl}${check.path}`;
  const headers = {
    Accept: "application/json",
  };

  let body;
  if (check.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(check.body);
  }

  try {
    const response = await fetch(url, {
      method: check.method,
      headers,
      body,
      signal: getTimeoutSignal(timeoutMs),
    });

    const elapsedMs = Date.now() - started;
    const rawBody = await response.text();
    const parsedBody = parseBody(rawBody);

    const isExpected = check.expectedStatuses.includes(response.status);
    const isTolerated = check.toleratedStatuses.includes(response.status);

    if (isExpected) {
      return {
        level: "PASS",
        ok: true,
        name: check.name,
        label: check.label,
        method: check.method,
        url,
        path: check.path,
        status: response.status,
        elapsedMs,
        detail: toOneLine(parsedBody),
      };
    }

    if (isTolerated) {
      return {
        level: "WARN",
        ok: true,
        name: check.name,
        label: check.label,
        method: check.method,
        url,
        path: check.path,
        status: response.status,
        elapsedMs,
        detail: toOneLine(parsedBody) || "Tolerated transient external dependency response.",
      };
    }

    return {
      level: "FAIL",
      ok: false,
      name: check.name,
      label: check.label,
      method: check.method,
      url,
      path: check.path,
      status: response.status,
      elapsedMs,
      detail: toOneLine(parsedBody),
    };
  } catch (error) {
    const elapsedMs = Date.now() - started;
    return {
      level: "FAIL",
      ok: false,
      name: check.name,
      label: check.label,
      method: check.method,
      url,
      path: check.path,
      status: null,
      elapsedMs,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  console.log("Smart Home Manager API smoke test");
  console.log(`Next API Base URL: ${baseUrl}`);
  console.log("Service Base URLs:");
  console.log(`- appliance-service: ${serviceBaseUrls.appliance}`);
  console.log(`- bill-service: ${serviceBaseUrls.bill}`);
  console.log(`- budget-service: ${serviceBaseUrls.budget}`);
  console.log(`- history-service: ${serviceBaseUrls.history}`);
  console.log(`- rate-service: ${serviceBaseUrls.rate}`);
  console.log(`- calculatebill-service: ${serviceBaseUrls.calculatebill}`);
  console.log(`- forecastbill-service: ${serviceBaseUrls.forecastbill}`);
  console.log(`Timeout: ${timeoutMs}ms`);
  console.log("");

  const results = [];
  for (const check of checks) {
    const result = await runCheck(check);
    results.push(result);

    const statusPart = result.status === null ? "no-http-status" : `HTTP ${result.status}`;
    const detailPart = result.detail ? ` | ${result.detail}` : "";
    console.log(
      `[${result.level}] ${result.method} ${result.url} (${result.name}, ${result.label}) -> ${statusPart} in ${result.elapsedMs}ms${detailPart}`,
    );
  }

  const passed = results.filter((result) => result.level === "PASS").length;
  const warned = results.filter((result) => result.level === "WARN").length;
  const failed = results.filter((result) => result.level === "FAIL").length;

  console.log("");
  console.log(`Summary: ${passed} passed, ${warned} warned, ${failed} failed`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Smoke test runner failed unexpectedly:", error);
  process.exitCode = 1;
});
