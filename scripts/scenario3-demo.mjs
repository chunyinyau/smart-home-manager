const base = process.env.SCENARIO3_BASE_URL ?? "http://127.0.0.1:3000/api";
const uid = process.env.SCENARIO3_UID ?? "user_demo_001";
const budgetUserId = process.env.SCENARIO3_BUDGET_UID ?? "1";
const phase = (process.argv[2] ?? "prepare").toLowerCase();
const forcedOffMinutes = Number(process.env.SCENARIO3_OFF_MINUTES ?? 360);

async function j(path, options) {
  const response = await fetch(`${base}${path}`, options);
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { ok: response.ok, status: response.status, body };
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

async function clearOverrides() {
  const list = await j(`/appliance?uid=${encodeURIComponent(uid)}`);
  const appliances = Array.isArray(list.body) ? list.body : [];
  const active = appliances.filter((a) => a?.manualOverride?.active);

  for (const appliance of active) {
    await j("/request-change", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid, aid: appliance.id, targetState: "ON" }),
    });
  }

  return active.map((a) => a.id);
}

async function ensureAirconOn() {
  await j("/request-change", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uid, aid: "app_2", targetState: "ON" }),
  });
}

async function setBudgetCap(cap) {
  return j("/budget/cap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uid: budgetUserId, monthlyCap: cap }),
  });
}

async function getForecast() {
  return j(`/forecast?uid=${encodeURIComponent(uid)}`);
}

async function getRecommendation() {
  return j(`/forecast/recommendation?uid=${encodeURIComponent(uid)}`);
}

async function applyTopRecommendation(recommendation) {
  const top = Array.isArray(recommendation?.recommendations)
    ? recommendation.recommendations[0]
    : null;

  if (!top?.applianceId) {
    return { applied: false, reason: "No top recommendation" };
  }

  const suggestedDuration = Number(top.suggestedDurationMinutes || recommendation.recommendedDurationMinutes || 60);
  const duration = Number.isFinite(forcedOffMinutes) && forcedOffMinutes > 0
    ? forcedOffMinutes
    : suggestedDuration;
  const apply = await j("/request-change", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      uid,
      aid: top.applianceId,
      targetState: "OFF",
      durationMinutes: Math.max(1, Math.round(duration)),
    }),
  });

  return {
    applied: apply.ok,
    status: apply.status,
    confirmation: apply.body?.confirmation_text,
    top,
    duration: Math.max(1, Math.round(duration)),
    forcedDurationMinutes: Number.isFinite(forcedOffMinutes) && forcedOffMinutes > 0
      ? Math.max(1, Math.round(forcedOffMinutes))
      : null,
  };
}

async function prepareScenario() {
  const cleared = await clearOverrides();
  await ensureAirconOn();

  const baselineForecast = await getForecast();
  const recommendation = await getRecommendation();
  const projected = Number(baselineForecast.body?.projectedCost || 0);
  const topRecommendation = Array.isArray(recommendation.body?.recommendations)
    ? recommendation.body.recommendations[0] ?? null
    : null;
  const topSavings = Number(topRecommendation?.estimatedSavingsSgd || 0);

  // SAFE boundary is 85% of cap in current risk model.
  // Choose a cap where:
  // - before action: projected / cap > 0.85 (HIGH)
  // - after action: (projected - topSavings) / cap <= 0.85 (SAFE)
  // This makes one "Apply" demo action able to flip HIGH -> SAFE.
  const safeThreshold = 0.85;
  const minCapForSafeAfterAction =
    topSavings > 0
      ? (projected - topSavings) / safeThreshold
      : projected / safeThreshold;
  const maxCapStillHighBeforeAction = projected / safeThreshold;

  let cap = round2(projected > 0 ? projected / 0.86 : 170);
  if (projected > 0 && topSavings > 0) {
    const midpoint =
      minCapForSafeAfterAction +
      (maxCapStillHighBeforeAction - minCapForSafeAfterAction) * 0.5;
    // Keep a slight downward bias so we stay in HIGH before action.
    cap = round2(Math.max(minCapForSafeAfterAction, midpoint - 0.1));
  }

  await setBudgetCap(cap);

  const afterCapForecast = await getForecast();
  const afterCapRecommendation = await getRecommendation();

  return {
    phase: "prepare",
    clearedOverrides: cleared,
    baseline: {
      risk: afterCapForecast.body?.riskLevel,
      projected: afterCapForecast.body?.projectedCost,
      budget: afterCapForecast.body?.budget?.budgetCap,
      overrideSaved: afterCapForecast.body?.overrideAdjustment?.estimatedSavedSgd,
    },
    topRecommendation,
    predictedRisk: afterCapRecommendation.body?.predictedRiskLevel,
    calibration: {
      projected,
      topSavings,
      safeThreshold,
      minCapForSafeAfterAction: round2(minCapForSafeAfterAction),
      maxCapStillHighBeforeAction: round2(maxCapStillHighBeforeAction),
      selectedCap: cap,
    },
    note: "Open dashboard now and click Apply on top suggested action.",
  };
}

async function applyScenario() {
  const recommendation = await getRecommendation();
  const apply = await applyTopRecommendation(recommendation.body);
  const after = await getForecast();

  return {
    phase: "apply",
    applied: apply,
    after: {
      risk: after.body?.riskLevel,
      projected: after.body?.projectedCost,
      budget: after.body?.budget?.budgetCap,
      overrideSaved: after.body?.overrideAdjustment?.estimatedSavedSgd,
    },
  };
}

async function main() {
  if (phase === "prepare") {
    console.log(JSON.stringify(await prepareScenario(), null, 2));
    return;
  }

  if (phase === "apply") {
    console.log(JSON.stringify(await applyScenario(), null, 2));
    return;
  }

  if (phase === "full") {
    const prepared = await prepareScenario();
    const applied = await applyScenario();
    console.log(JSON.stringify({ prepared, applied }, null, 2));
    return;
  }

  console.error("Unknown phase. Use: prepare | apply | full");
  process.exit(1);
}

main().catch((error) => {
  console.error("Scenario 3 demo script failed:", error);
  process.exit(1);
});
