import calendar
import json
import logging
import os
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, timezone
from math import ceil
from typing import Any

AI_RESPONSES_URL = "https://api.openai.com/v1/responses"
DEFAULT_MODEL = os.getenv("PICOCLAW_MODEL", "gpt-5.4-mini")
logger = logging.getLogger(__name__)


def _parse_float(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None

    if not (parsed == parsed) or parsed in (float("inf"), float("-inf")):
        return None

    return parsed


def _parse_datetime(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None

    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None

    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _parse_date(value: Any) -> date | None:
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    if not isinstance(value, str) or not value.strip():
        return None

    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def _days_in_month(period_start: date) -> int:
    return calendar.monthrange(period_start.year, period_start.month)[1]


def _derive_risk_level(projected_cost: float, budget_cap: float) -> str:
    if budget_cap <= 0:
        return "CRITICAL"

    ratio = projected_cost / budget_cap
    if ratio >= 1:
        return "CRITICAL"
    if ratio >= 0.85:
        return "HIGH"
    return "SAFE"


def _linear_regression(points: list[tuple[float, float]]) -> tuple[float, float, bool]:
    count = len(points)
    if count < 2:
        return 0.0, 0.0, False

    sum_x = sum(point[0] for point in points)
    sum_y = sum(point[1] for point in points)
    sum_xx = sum(point[0] * point[0] for point in points)
    sum_xy = sum(point[0] * point[1] for point in points)

    denominator = count * sum_xx - sum_x * sum_x
    if abs(denominator) < 1e-9:
        return 0.0, 0.0, False

    slope = (count * sum_xy - sum_x * sum_y) / denominator
    intercept = (sum_y - slope * sum_x) / count
    return slope, intercept, True


def _sanitize_recommendations(values: Any) -> list[str]:
    if not isinstance(values, list):
        return []

    normalized: list[str] = []
    seen: set[str] = set()
    for item in values:
        if not isinstance(item, str):
            continue
        candidate = item.strip()
        if len(candidate) < 4:
            continue
        key = candidate.lower()
        if key in seen:
            continue
        seen.add(key)
        normalized.append(candidate)
    return normalized


def _build_recommendations(
    risk_level: str,
    hdb_type: str,
    baseline_monthly_kwh: float,
    projected_month_end_kwh: float,
) -> list[str]:
    pressure = projected_month_end_kwh - baseline_monthly_kwh
    household_hint = f"for HDB type {hdb_type}" if hdb_type else "for your household"

    if risk_level == "CRITICAL":
        return [
            f"Air conditioner: turn off whenever rooms are empty ({household_hint}).",
            "Water heater: limit each usage cycle and power off after use.",
            "Clothes dryer: defer non-essential drying loads this week.",
            "Desktop/gaming setup: shut down fully overnight.",
            "TV and set-top box: switch off at the socket to remove standby draw.",
        ]

    if risk_level == "HIGH":
        recommendations = [
            "Air conditioner: raise setpoint by 1-2C and reduce runtime.",
            "Water heater: avoid reheating between consecutive showers.",
            "Kitchen appliances: avoid overlapping oven, kettle, and dryer cycles.",
        ]
        if pressure > 25:
            recommendations.append("Delay non-critical laundry and ironing until next billing period.")
        return recommendations

    safe_recommendations = [
        "Keep current routine; turn off air conditioner earlier where possible.",
        "Power down entertainment devices at the socket before sleep.",
    ]
    if pressure > 0:
        safe_recommendations.append("Monitor heater and kitchen appliance runtime in the final week.")
    return safe_recommendations


def _build_short_narrative(
    risk_level: str,
    projected_month_end_cost: float,
    budget_cap: float,
    projected_month_end_kwh: float,
    baseline_monthly_kwh: float,
) -> str:
    delta_cost = projected_month_end_cost - budget_cap
    delta_kwh = projected_month_end_kwh - baseline_monthly_kwh

    if risk_level == "CRITICAL":
        return (
            f"Linear regression projects month-end spend at {projected_month_end_cost:.2f} SGD, "
            f"about {abs(delta_cost):.2f} SGD above budget; immediate load reduction is recommended."
        )

    if risk_level == "HIGH":
        return (
            f"Projected spend is {projected_month_end_cost:.2f} SGD and is nearing your cap; "
            "target high-draw appliances now to avoid crossing the budget."
        )

    if delta_kwh > 0:
        return (
            f"Projected spend stays within budget at {projected_month_end_cost:.2f} SGD, "
            f"but expected usage is {delta_kwh:.1f} kWh above baseline, so keep usage stable."
        )

    return (
        f"Projected spend is {projected_month_end_cost:.2f} SGD and remains safely under budget "
        "with current consumption trends."
    )


def _parse_history_records(input_payload: dict[str, Any]) -> list[dict[str, Any]]:
    billing = input_payload.get("billing") if isinstance(input_payload.get("billing"), dict) else {}

    raw_history = (
        billing.get("current_period_history")
        or billing.get("currentPeriodHistory")
        or billing.get("sameMonthSpendHistory")
        or input_payload.get("sameMonthSpendHistory")
    )
    if not isinstance(raw_history, list):
        return []

    normalized: list[dict[str, Any]] = []
    for item in raw_history:
        if not isinstance(item, dict):
            continue

        period_cost = _parse_float(item.get("periodCostSgd"))
        if period_cost is None:
            period_cost = _parse_float(item.get("period_cost_sgd"))

        period_kwh = _parse_float(item.get("periodKwh"))
        if period_kwh is None:
            period_kwh = _parse_float(item.get("period_kwh"))

        computed_at = _parse_datetime(item.get("computedAt"))
        if computed_at is None:
            computed_at = _parse_datetime(item.get("computed_at"))

        billing_period_start = _parse_date(item.get("billingPeriodStart"))
        if billing_period_start is None:
            billing_period_start = _parse_date(item.get("billing_period_start"))

        if period_cost is None or period_kwh is None:
            continue

        normalized.append(
            {
                "period_cost_sgd": max(0.0, period_cost),
                "period_kwh": max(0.0, period_kwh),
                "computed_at": computed_at,
                "billing_period_start": billing_period_start,
            }
        )

    normalized.sort(
        key=lambda row: (
            row.get("billing_period_start") or date.min,
            row.get("computed_at") or datetime.min.replace(tzinfo=timezone.utc),
        )
    )
    return normalized


def _resolve_period_start(input_payload: dict[str, Any], history: list[dict[str, Any]]) -> date:
    top_level = _parse_date(input_payload.get("billing_period_start"))
    if top_level is not None:
        return top_level

    for item in reversed(history):
        parsed = item.get("billing_period_start")
        if isinstance(parsed, date):
            return parsed

    now = datetime.now(timezone.utc)
    return date(now.year, now.month, 1)


def _resolve_days_elapsed(input_payload: dict[str, Any], period_start: date, now_utc: datetime) -> float:
    supplied = _parse_float(input_payload.get("days_elapsed"))
    if supplied is None:
        supplied = _parse_float(input_payload.get("daysElapsed"))

    days_in_period = _days_in_month(period_start)
    if supplied is not None and supplied > 0:
        return max(1.0, min(float(supplied), float(days_in_period)))

    computed = float((now_utc.date() - period_start).days + 1)
    return max(1.0, min(computed, float(days_in_period)))


def _safe_budget_values(input_payload: dict[str, Any]) -> tuple[float, float]:
    budget = input_payload.get("budget") if isinstance(input_payload.get("budget"), dict) else {}

    budget_cap = _parse_float(budget.get("budget_cap"))
    if budget_cap is None:
        budget_cap = _parse_float(budget.get("budgetCap"))
    if budget_cap is None or budget_cap <= 0:
        budget_cap = 100.0

    current_cumulative = _parse_float(budget.get("cum_bill"))
    if current_cumulative is None:
        current_cumulative = _parse_float(budget.get("cumBill"))
    if current_cumulative is None:
        current_cumulative = 0.0

    return round(budget_cap, 2), round(max(0.0, current_cumulative), 4)


def _safe_profile_values(input_payload: dict[str, Any]) -> tuple[str, float]:
    profile = input_payload.get("profile") if isinstance(input_payload.get("profile"), dict) else {}

    hdb_type_raw = profile.get("hdb_type")
    if hdb_type_raw is None:
        hdb_type_raw = profile.get("hdbType")
    hdb_type = str(hdb_type_raw).strip() if hdb_type_raw is not None else "4"

    baseline_monthly_kwh = _parse_float(profile.get("baseline_monthly_kwh"))
    if baseline_monthly_kwh is None:
        baseline_monthly_kwh = _parse_float(profile.get("baselineMonthlyKwh"))
    if baseline_monthly_kwh is None or baseline_monthly_kwh <= 0:
        baseline_monthly_kwh = 350.0

    return hdb_type, round(baseline_monthly_kwh, 2)


def _build_deterministic_assessment(input_payload: dict[str, Any]) -> dict[str, Any]:
    now_utc = datetime.now(timezone.utc)
    history = _parse_history_records(input_payload)
    period_start = _resolve_period_start(input_payload, history)
    days_in_period = _days_in_month(period_start)
    days_elapsed = _resolve_days_elapsed(input_payload, period_start, now_utc)
    projection_day = float(days_in_period)

    budget_cap, _ = _safe_budget_values(input_payload)
    hdb_type, baseline_monthly_kwh = _safe_profile_values(input_payload)

    cumulative_cost = 0.0
    cumulative_kwh = 0.0
    cost_points: list[tuple[float, float]] = []
    kwh_points: list[tuple[float, float]] = []

    for row in history:
        cumulative_cost += float(row["period_cost_sgd"])
        cumulative_kwh += float(row["period_kwh"])

        computed_at = row.get("computed_at")
        if isinstance(computed_at, datetime):
            day_index = (computed_at.date() - period_start).days + 1
            x_value = max(1.0, float(day_index))
        else:
            # Fall back to evenly spaced points when timestamps are missing.
            x_value = float(len(cost_points) + 1)

        cost_points.append((x_value, cumulative_cost))
        kwh_points.append((x_value, cumulative_kwh))

    if not cost_points:
        billing = input_payload.get("billing") if isinstance(input_payload.get("billing"), dict) else {}
        initial_cost = _parse_float(billing.get("current_period_total_cost"))
        if initial_cost is None:
            initial_cost = _parse_float(billing.get("currentPeriodTotalCost"))
        if initial_cost is None:
            initial_cost = 0.0

        initial_kwh = _parse_float(billing.get("current_period_total_kwh"))
        if initial_kwh is None:
            initial_kwh = _parse_float(billing.get("currentPeriodTotalKwh"))
        if initial_kwh is None:
            initial_kwh = 0.0

        cumulative_cost = max(0.0, initial_cost)
        cumulative_kwh = max(0.0, initial_kwh)

        if cumulative_cost > 0 or cumulative_kwh > 0:
            cost_points.append((days_elapsed, cumulative_cost))
            kwh_points.append((days_elapsed, cumulative_kwh))

    cost_slope, cost_intercept, cost_regression_ok = _linear_regression(cost_points)
    kwh_slope, kwh_intercept, kwh_regression_ok = _linear_regression(kwh_points)

    if cost_regression_ok:
        projected_cost = cost_slope * projection_day + cost_intercept
    else:
        daily_cost = (cumulative_cost / days_elapsed) if days_elapsed > 0 else 0.0
        cost_slope = daily_cost
        cost_intercept = 0.0
        projected_cost = daily_cost * projection_day

    if kwh_regression_ok:
        projected_kwh = kwh_slope * projection_day + kwh_intercept
    else:
        daily_kwh = (cumulative_kwh / days_elapsed) if days_elapsed > 0 else 0.0
        kwh_slope = daily_kwh
        kwh_intercept = 0.0
        projected_kwh = daily_kwh * projection_day

    projected_month_end_cost = round(max(cumulative_cost, projected_cost, 0.0), 2)
    projected_month_end_kwh = round(max(cumulative_kwh, projected_kwh, 0.0), 2)
    risk_level = _derive_risk_level(projected_month_end_cost, budget_cap)

    days_to_exceed: int | None = None
    daily_spend = max(cost_slope, cumulative_cost / days_elapsed if days_elapsed > 0 else 0.0)
    if projected_month_end_cost > budget_cap:
        if cumulative_cost >= budget_cap:
            days_to_exceed = 0
        elif daily_spend > 0:
            days_to_exceed = max(1, int(ceil((budget_cap - cumulative_cost) / daily_spend)))

    recommendations = _build_recommendations(
        risk_level,
        hdb_type,
        baseline_monthly_kwh,
        projected_month_end_kwh,
    )

    assessment = {
        "projected_month_end_cost": projected_month_end_cost,
        "projected_month_end_kwh": projected_month_end_kwh,
        "risk_level": risk_level,
        "days_to_exceed": days_to_exceed,
        "short_narrative": _build_short_narrative(
            risk_level,
            projected_month_end_cost,
            budget_cap,
            projected_month_end_kwh,
            baseline_monthly_kwh,
        ),
        "recommended_appliances": recommendations,
        "model": {
            "method": "linear_regression" if (cost_regression_ok and kwh_regression_ok) else "average_daily_projection",
            "points_used": len(cost_points),
            "days_elapsed": round(days_elapsed, 2),
            "days_in_period": days_in_period,
            "cost_slope_per_day": round(max(cost_slope, 0.0), 6),
            "cost_intercept": round(cost_intercept, 6),
            "kwh_slope_per_day": round(max(kwh_slope, 0.0), 6),
            "kwh_intercept": round(kwh_intercept, 6),
        },
    }
    return assessment


def _resolve_api_key() -> tuple[str | None, str | None]:
    api_key = os.getenv("PICOCLAW_API_KEY")
    if api_key:
        return api_key, "PICOCLAW_API_KEY"

    return None, None


def _extract_output_text(payload: dict[str, Any]) -> str | None:
    direct_text = payload.get("output_text")
    if isinstance(direct_text, str) and direct_text.strip():
        return direct_text

    output = payload.get("output")
    if not isinstance(output, list):
        return None

    for item in output:
        if not isinstance(item, dict):
            continue

        content = item.get("content")
        if not isinstance(content, list):
            continue

        for part in content:
            if not isinstance(part, dict):
                continue
            text = part.get("text")
            if isinstance(text, str) and text.strip():
                return text

    return None


def _parse_llm_refinement(output_text: str) -> dict[str, Any] | None:
    try:
        parsed = json.loads(output_text)
    except json.JSONDecodeError:
        return None

    if not isinstance(parsed, dict):
        return None

    short_narrative = parsed.get("short_narrative")
    recommendations = _sanitize_recommendations(parsed.get("recommended_appliances"))

    if not isinstance(short_narrative, str) or len(short_narrative.strip()) < 12:
        return None
    if len(recommendations) < 2:
        return None

    return {
        "short_narrative": short_narrative.strip(),
        "recommended_appliances": recommendations,
    }


def _enhance_with_ai(
    input_payload: dict[str, Any],
    deterministic_assessment: dict[str, Any],
) -> dict[str, Any] | None:
    api_key, api_key_source = _resolve_api_key()
    if not api_key:
        return None

    logger.info(
        "Using %s ending in ...%s with model %s",
        api_key_source,
        api_key[-4:] if len(api_key) >= 4 else api_key,
        DEFAULT_MODEL,
    )

    prompt = "\n".join(
        [
            "You are PicoClaw, an energy budget assistant.",
            "Given deterministic linear-regression results, refine only messaging.",
            "Do not change numeric forecast values or risk level.",
            "Return JSON only with keys: short_narrative, recommended_appliances.",
            "recommended_appliances must be 2 to 5 practical appliance-focused suggestions.",
            "Deterministic result:",
            json.dumps(deterministic_assessment),
            "Forecast input:",
            json.dumps(input_payload),
        ]
    )

    request_body = {
        "model": DEFAULT_MODEL,
        "input": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": prompt,
                    }
                ],
            }
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "forecast_bill_refinement",
                "strict": True,
                "schema": {
                    "type": "object",
                    "properties": {
                        "short_narrative": {
                            "type": "string",
                            "minLength": 12,
                            "maxLength": 220,
                        },
                        "recommended_appliances": {
                            "type": "array",
                            "minItems": 2,
                            "maxItems": 5,
                            "items": {
                                "type": "string",
                                "minLength": 4,
                                "maxLength": 140,
                            },
                        },
                    },
                    "required": ["short_narrative", "recommended_appliances"],
                    "additionalProperties": False,
                },
            }
        },
    }

    request = urllib.request.Request(
        AI_RESPONSES_URL,
        data=json.dumps(request_body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    with urllib.request.urlopen(request, timeout=20) as response:
        raw = response.read().decode("utf-8")

    payload = json.loads(raw)
    output_text = _extract_output_text(payload)
    if not output_text:
        return None

    return _parse_llm_refinement(output_text)


def run_forecast_check(input_payload: dict[str, Any]) -> dict[str, Any]:
    deterministic_assessment = _build_deterministic_assessment(input_payload)
    final_assessment = dict(deterministic_assessment)

    try:
        refinement = _enhance_with_ai(input_payload, deterministic_assessment)
        if refinement is not None:
            final_assessment["short_narrative"] = refinement["short_narrative"]
            final_assessment["recommended_appliances"] = refinement["recommended_appliances"]
            logger.info("Applied AI refinement on deterministic forecast output")
    except urllib.error.HTTPError as error:
        details = error.read().decode("utf-8", errors="replace")
        logger.warning("AI refinement HTTP %s: %s", error.code, details)
    except urllib.error.URLError as error:
        logger.warning("AI refinement request failed: %s", error)
    except Exception as error:
        logger.warning("AI refinement fallback: %s", error)

    return {
        "input": input_payload,
        "assessment": final_assessment,
    }


def _load_input_payload() -> dict[str, Any]:
    if len(sys.argv) > 1:
        return json.loads(sys.argv[1])

    stdin_text = sys.stdin.read().strip()
    if not stdin_text:
        raise RuntimeError("Provide input JSON via argv or stdin")

    return json.loads(stdin_text)


def main() -> int:
    logging.basicConfig(level=os.getenv("PICOCLAW_LOG_LEVEL", "INFO").upper())

    try:
        input_payload = _load_input_payload()
        result = run_forecast_check(input_payload)
        print(json.dumps(result, indent=2))
        return 0
    except Exception as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
