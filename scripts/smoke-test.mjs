const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_BUDGET_USER_ID = "1";
const DEFAULT_HISTORY_USER_ID = "user_demo_001";
const DEFAULT_UPDATEBUDGET_CAP_DELTA = 200;
const DEFAULT_UPDATEBUDGET_HISTORY_WAIT_MS = 1500;

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

const timeoutMs = Number.parseInt(
  process.env.SMOKE_TIMEOUT_MS ?? String(DEFAULT_TIMEOUT_MS),
  10,
);
const budgetUserId = process.env.SMOKE_BUDGET_USER_ID ?? DEFAULT_BUDGET_USER_ID;
const historyUserId = process.env.SMOKE_HISTORY_USER_ID ?? DEFAULT_HISTORY_USER_ID;
const updateBudgetCapDelta = Number.parseFloat(
  process.env.SMOKE_UPDATEBUDGET_CAP_DELTA ?? String(DEFAULT_UPDATEBUDGET_CAP_DELTA),
);
const updateBudgetHistoryWaitMs = Number.parseInt(
  process.env.SMOKE_UPDATEBUDGET_HISTORY_WAIT_MS
    ?? String(DEFAULT_UPDATEBUDGET_HISTORY_WAIT_MS),
  10,
);

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
  updatebudget: resolveBaseUrl("http://localhost:5012", [
    "SMOKE_UPDATEBUDGET_SERVICE_URL",
    "UPDATEBUDGET_SERVICE_BASE_URL",
    "UPDATEBUDGET_SERVICE_URL",
  ]),
  requestchange: resolveBaseUrl("http://localhost:5011", [
    "SMOKE_REQUEST_CHANGE_SERVICE_URL",
    "REQUEST_CHANGE_SERVICE_BASE_URL",
    "REQUEST_CHANGE_SERVICE_URL",
  ]),
  changestate: resolveBaseUrl("http://localhost:5010", [
    "SMOKE_CHANGE_STATE_SERVICE_URL",
    "CHANGE_STATE_SERVICE_BASE_URL",
    "CHANGE_STATE_SERVICE_URL",
  ]),
  kong: resolveBaseUrl("http://localhost:8000", [
    "SMOKE_KONG_BASE_URL",
    "KONG_BASE_URL",
  ]),
};

const checks = [
  {
    name: "Direct Rate Read",
    method: "GET",
    path: "/api/rate",
    baseUrl: serviceBaseUrls.rate,
    label: "rate-service",
    expectedStatuses: [200],
    toleratedStatuses: [],
  },
  {
    name: "Direct Rate Sync",
    method: "GET",
    path: "/api/rate/sync",
    baseUrl: serviceBaseUrls.rate,
    label: "rate-service",
    expectedStatuses: [200],
    toleratedStatuses: [429, 502],
  },
  {
    name: "Direct Budget Read",
    method: "GET",
    path: `/api/budget?user_id=${encodeURIComponent(budgetUserId)}`,
    baseUrl: serviceBaseUrls.budget,
    label: "budget-service",
    expectedStatuses: [200],
    toleratedStatuses: [],
  },
  {
    name: "Direct Telemetry Status",
    method: "GET",
    path: "/api/appliance/telemetry/status",
    baseUrl: serviceBaseUrls.appliance,
    label: "appliance-service",
    expectedStatuses: [200],
    toleratedStatuses: [],
  },
  {
    name: "Direct History Read",
    method: "GET",
    path: `/api/history?user_id=${encodeURIComponent(historyUserId)}`,
    baseUrl: serviceBaseUrls.history,
    label: "history-service",
    expectedStatuses: [200],
    toleratedStatuses: [],
  },
  {
    name: "Direct Forecast Read",
    method: "GET",
    path: `/api/forecast?uid=${encodeURIComponent(historyUserId)}`,
    baseUrl: serviceBaseUrls.forecastbill,
    label: "forecastbill-service",
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
  {
    name: "Request Change Service Health",
    method: "GET",
    path: "/",
    baseUrl: serviceBaseUrls.requestchange,
    label: "request-change-service",
    expectedStatuses: [200],
    toleratedStatuses: [],
  },
  {
    name: "Change State Service Health",
    method: "GET",
    path: "/",
    baseUrl: serviceBaseUrls.changestate,
    label: "change-state-service",
    expectedStatuses: [200],
    toleratedStatuses: [],
  },
  {
    name: "Kong UpdateBudget Root",
    method: "GET",
    path: "/updatebudget",
    baseUrl: serviceBaseUrls.kong,
    label: "kong-gateway",
    expectedStatuses: [200],
    toleratedStatuses: [],
  },
  {
    name: "Kong Request Change Root",
    method: "GET",
    path: "/request-change",
    baseUrl: serviceBaseUrls.kong,
    label: "kong-gateway",
    expectedStatuses: [200],
    toleratedStatuses: [],
  },
];

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

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function parsePositiveInteger(value) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function roundCurrency(value) {
  return Math.round(value * 100) / 100;
}

function readBudgetCap(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const cap = Number(payload.data?.budget_cap);
  return isFiniteNumber(cap) ? cap : null;
}

async function requestJson(url, options = {}) {
  const headers = {
    Accept: "application/json",
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers ?? {}),
  };

  const response = await fetch(url, {
    ...options,
    headers,
    signal: options.signal ?? getTimeoutSignal(timeoutMs),
  });

  const rawBody = await response.text();
  return {
    response,
    parsedBody: parseBody(rawBody),
  };
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

  try {
    const response = await fetch(url, {
      method: check.method,
      headers: {
        Accept: "application/json",
      },
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

async function runUpdateBudgetWorkflowCheck() {
  const started = Date.now();
  const name = "UpdateBudget Workflow";
  const label = "updatebudget-service";
  const method = "PUT/GET";

  const userId = parsePositiveInteger(budgetUserId);
  const uid = String(historyUserId || "").trim() || DEFAULT_HISTORY_USER_ID;
  const path = userId === null ? "/api/updatebudget/<invalid-user-id>" : `/api/updatebudget/${userId}`;
  const url = `${serviceBaseUrls.updatebudget}${path}`;

  const fail = (detail, status = null) => ({
    level: "FAIL",
    ok: false,
    name,
    label,
    method,
    url,
    path,
    status,
    elapsedMs: Date.now() - started,
    detail,
  });

  if (userId === null) {
    return fail("SMOKE_BUDGET_USER_ID must be a positive integer.");
  }

  let originalBudgetCap = null;
  let shouldRestoreBudgetCap = false;

  try {
    const forecastTarget = `${serviceBaseUrls.forecastbill}/api/forecast`;
    const forecastResult = await requestJson(forecastTarget, {
      method: "POST",
      body: JSON.stringify({
        uid,
        user_id: userId,
        profile_id: String(userId),
      }),
    });

    if (!forecastResult.response.ok) {
      return fail(
        `Unable to read projectedCost from forecastbill-service: HTTP ${forecastResult.response.status} | ${toOneLine(forecastResult.parsedBody)}`,
        forecastResult.response.status,
      );
    }

    const projectedCost = Number(forecastResult.parsedBody?.projectedCost);
    if (!isFiniteNumber(projectedCost) || projectedCost < 0) {
      return fail("forecastbill-service response did not include a valid projectedCost.", 200);
    }

    const validatedDelta = isFiniteNumber(updateBudgetCapDelta) && updateBudgetCapDelta > 0
      ? updateBudgetCapDelta
      : DEFAULT_UPDATEBUDGET_CAP_DELTA;
    const acceptedCap = roundCurrency(projectedCost + validatedDelta);
    const rejectedCap = roundCurrency(Math.max(projectedCost - validatedDelta, 0.01));

    const budgetTarget = `${serviceBaseUrls.budget}/api/budget/${userId}`;
    const beforeBudget = await requestJson(budgetTarget, { method: "GET" });
    if (!beforeBudget.response.ok) {
      return fail(
        `Unable to read budget before workflow: HTTP ${beforeBudget.response.status} | ${toOneLine(beforeBudget.parsedBody)}`,
        beforeBudget.response.status,
      );
    }

    originalBudgetCap = readBudgetCap(beforeBudget.parsedBody);
    if (!isFiniteNumber(originalBudgetCap)) {
      return fail("Budget service payload is missing data.budget_cap before workflow.", 200);
    }
    shouldRestoreBudgetCap = true;

    const acceptedResult = await requestJson(url, {
      method: "PUT",
      body: JSON.stringify({
        budget_cap: acceptedCap,
        uid,
        profile_id: String(userId),
      }),
    });

    if (!acceptedResult.response.ok) {
      return fail(
        `Accepted updatebudget call failed: HTTP ${acceptedResult.response.status} | ${toOneLine(acceptedResult.parsedBody)}`,
        acceptedResult.response.status,
      );
    }

    if (
      acceptedResult.parsedBody?.accepted !== true
      || acceptedResult.parsedBody?.action !== "budget_update_accepted"
      || acceptedResult.parsedBody?.history?.event !== "BudgetUpdateAccepted"
    ) {
      return fail(
        `Accepted response shape mismatch: ${toOneLine(acceptedResult.parsedBody)}`,
        acceptedResult.response.status,
      );
    }

    const afterAcceptedBudget = await requestJson(budgetTarget, { method: "GET" });
    if (!afterAcceptedBudget.response.ok) {
      return fail(
        `Unable to read budget after accepted update: HTTP ${afterAcceptedBudget.response.status} | ${toOneLine(afterAcceptedBudget.parsedBody)}`,
        afterAcceptedBudget.response.status,
      );
    }

    const afterAcceptedCap = readBudgetCap(afterAcceptedBudget.parsedBody);
    if (!isFiniteNumber(afterAcceptedCap) || Math.abs(afterAcceptedCap - acceptedCap) > 0.01) {
      return fail(
        `Accepted update did not set budget_cap to ${acceptedCap.toFixed(2)} (actual ${String(afterAcceptedCap)}).`,
        200,
      );
    }

    const rejectedResult = await requestJson(url, {
      method: "PUT",
      body: JSON.stringify({
        budget_cap: rejectedCap,
        uid,
        profile_id: String(userId),
      }),
    });

    if (!rejectedResult.response.ok) {
      return fail(
        `Rejected updatebudget call failed: HTTP ${rejectedResult.response.status} | ${toOneLine(rejectedResult.parsedBody)}`,
        rejectedResult.response.status,
      );
    }

    if (
      rejectedResult.parsedBody?.accepted !== false
      || rejectedResult.parsedBody?.action !== "budget_update_rejected"
      || rejectedResult.parsedBody?.history?.event !== "BudgetUpdateRejected"
    ) {
      return fail(
        `Rejected response shape mismatch: ${toOneLine(rejectedResult.parsedBody)}`,
        rejectedResult.response.status,
      );
    }

    const afterRejectedBudget = await requestJson(budgetTarget, { method: "GET" });
    if (!afterRejectedBudget.response.ok) {
      return fail(
        `Unable to read budget after rejected update: HTTP ${afterRejectedBudget.response.status} | ${toOneLine(afterRejectedBudget.parsedBody)}`,
        afterRejectedBudget.response.status,
      );
    }

    const afterRejectedCap = readBudgetCap(afterRejectedBudget.parsedBody);
    if (!isFiniteNumber(afterRejectedCap) || Math.abs(afterRejectedCap - afterAcceptedCap) > 0.01) {
      return fail(
        `Rejected update unexpectedly changed budget_cap (after accepted ${afterAcceptedCap}, after rejected ${String(afterRejectedCap)}).`,
        200,
      );
    }

    const validatedWaitMs = Number.isFinite(updateBudgetHistoryWaitMs) && updateBudgetHistoryWaitMs >= 0
      ? updateBudgetHistoryWaitMs
      : DEFAULT_UPDATEBUDGET_HISTORY_WAIT_MS;
    await sleep(validatedWaitMs);

    const historyTarget = `${serviceBaseUrls.history}/api/history?user_id=${encodeURIComponent(uid)}`;
    const historyResult = await requestJson(historyTarget, { method: "GET" });
    if (!historyResult.response.ok) {
      return fail(
        `Unable to read history after workflow: HTTP ${historyResult.response.status} | ${toOneLine(historyResult.parsedBody)}`,
        historyResult.response.status,
      );
    }

    const rows = Array.isArray(historyResult.parsedBody) ? historyResult.parsedBody : [];
    const acceptedSignature = `BudgetUpdateAccepted: requested budget_cap $${acceptedCap.toFixed(2)};`;
    const rejectedSignature = `BudgetUpdateRejected: requested budget_cap $${rejectedCap.toFixed(2)};`;

    const hasAcceptedLog = rows.some(
      (row) => row && typeof row.message === "string" && row.message.includes(acceptedSignature),
    );
    const hasRejectedLog = rows.some(
      (row) => row && typeof row.message === "string" && row.message.includes(rejectedSignature),
    );

    if (!hasAcceptedLog || !hasRejectedLog) {
      return fail(
        `History log signatures not found (accepted=${String(hasAcceptedLog)}, rejected=${String(hasRejectedLog)}).`,
        200,
      );
    }

    return {
      level: "PASS",
      ok: true,
      name,
      label,
      method,
      url,
      path,
      status: 200,
      elapsedMs: Date.now() - started,
      detail:
        `projected=${projectedCost.toFixed(2)}, acceptedCap=${acceptedCap.toFixed(2)}, `
        + `rejectedCap=${rejectedCap.toFixed(2)}, afterAccepted=${afterAcceptedCap.toFixed(2)}, afterRejected=${afterRejectedCap.toFixed(2)}`,
    };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  } finally {
    if (shouldRestoreBudgetCap && isFiniteNumber(originalBudgetCap)) {
      try {
        const restoreTarget = `${serviceBaseUrls.budget}/api/budget/${userId}/cap`;
        const restoreResult = await requestJson(restoreTarget, {
          method: "PATCH",
          body: JSON.stringify({ budget_cap: roundCurrency(originalBudgetCap) }),
        });

        if (!restoreResult.response.ok) {
          console.warn(
            "[WARN] UpdateBudget workflow cleanup could not restore budget_cap:"
            + ` HTTP ${restoreResult.response.status} | ${toOneLine(restoreResult.parsedBody)}`,
          );
        }
      } catch (error) {
        console.warn(
          "[WARN] UpdateBudget workflow cleanup failed:",
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }
}

async function main() {
  console.log("Smart Home Manager API smoke test");
  console.log("Service Base URLs:");
  console.log(`- appliance-service: ${serviceBaseUrls.appliance}`);
  console.log(`- bill-service: ${serviceBaseUrls.bill}`);
  console.log(`- budget-service: ${serviceBaseUrls.budget}`);
  console.log(`- history-service: ${serviceBaseUrls.history}`);
  console.log(`- rate-service: ${serviceBaseUrls.rate}`);
  console.log(`- calculatebill-service: ${serviceBaseUrls.calculatebill}`);
  console.log(`- forecastbill-service: ${serviceBaseUrls.forecastbill}`);
  console.log(`- updatebudget-service: ${serviceBaseUrls.updatebudget}`);
  console.log(`- request-change-service: ${serviceBaseUrls.requestchange}`);
  console.log(`- change-state-service: ${serviceBaseUrls.changestate}`);
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

  const updateBudgetWorkflowResult = await runUpdateBudgetWorkflowCheck();
  results.push(updateBudgetWorkflowResult);
  {
    const statusPart = updateBudgetWorkflowResult.status === null
      ? "no-http-status"
      : `HTTP ${updateBudgetWorkflowResult.status}`;
    const detailPart = updateBudgetWorkflowResult.detail
      ? ` | ${updateBudgetWorkflowResult.detail}`
      : "";
    console.log(
      `[${updateBudgetWorkflowResult.level}] ${updateBudgetWorkflowResult.method} ${updateBudgetWorkflowResult.url} (${updateBudgetWorkflowResult.name}, ${updateBudgetWorkflowResult.label}) -> ${statusPart} in ${updateBudgetWorkflowResult.elapsedMs}ms${detailPart}`,
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
