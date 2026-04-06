import json
import os
import urllib.error
import urllib.request
from typing import Any, Optional

AI_RESPONSES_URL = os.getenv("AI_RESPONSES_URL", "https://api.openai.com/v1/responses")
PICOCLAW_MODEL = os.getenv("PICOCLAW_MODEL", "gpt-5.4-mini")


def parse_float(value: Any) -> Optional[float]:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None

    if not (parsed == parsed) or parsed in (float("inf"), float("-inf")):
        return None

    return parsed


def resolve_picoclaw_api_key() -> Optional[str]:
    api_key = os.getenv("PICOCLAW_API_KEY") or os.getenv("OPENAI_API_KEY")
    if isinstance(api_key, str) and api_key.strip():
        return api_key.strip()

    return None


def extract_response_output_text(payload: Any) -> Optional[str]:
    if not isinstance(payload, dict):
        return None

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


def get_ai_recommendation_adjustments(
    uid: str,
    risk_level: str,
    projected_cost: float,
    budget_cap: float,
    required_savings_for_safe: float,
    price_per_kwh: float,
    max_devices: int,
    default_duration_minutes: int,
    candidates: list[dict[str, Any]],
) -> dict[str, Any]:
    api_key = resolve_picoclaw_api_key()
    if not api_key:
        return {
            "used": False,
            "reason": "api-key-not-set",
            "scores": {},
            "durationMultipliers": {},
        }

    shortlist = sorted(
        candidates,
        key=lambda appliance: (
            -float(appliance.get("currentWatts") or 0),
            int(appliance.get("priority") or 99),
        ),
    )[:8]

    candidate_rows: list[dict[str, Any]] = []
    for appliance in shortlist:
        appliance_id = str(appliance.get("id") or "").strip()
        if not appliance_id:
            continue
        candidate_rows.append(
            {
                "applianceId": appliance_id,
                "name": str(appliance.get("name") or "Appliance"),
                "type": str(appliance.get("type") or "Unknown"),
                "priority": int(appliance.get("priority") or 99),
                "currentWatts": round(max(0.0, float(appliance.get("currentWatts") or 0.0)), 2),
            }
        )

    if not candidate_rows:
        return {
            "used": False,
            "reason": "no-candidates",
            "scores": {},
            "durationMultipliers": {},
        }

    prompt = "\n".join(
        [
            "You are an energy optimization planner.",
            "Rank candidate appliances for temporary shutdown to move budget risk toward SAFE.",
            "Balance savings potential with user practicality; avoid extreme durations unless necessary.",
            "Return JSON only following the schema.",
            "Context:",
            json.dumps(
                {
                    "uid": uid,
                    "riskLevel": risk_level,
                    "projectedCost": round(projected_cost, 2),
                    "budgetCap": round(budget_cap, 2),
                    "requiredSavingsForSafeSgd": round(required_savings_for_safe, 4),
                    "pricePerKwh": round(max(price_per_kwh, 0.0), 6),
                    "maxDevices": max_devices,
                    "defaultDurationMinutes": default_duration_minutes,
                    "candidates": candidate_rows,
                }
            ),
            "Rules:",
            "- score is 0 to 100, higher means better candidate now.",
            "- durationMultiplier is 0.5 to 3.0 and scales deterministic duration.",
            "- include only appliance IDs from candidates.",
        ]
    )

    request_body = {
        "model": PICOCLAW_MODEL,
        "input": [
            {
                "role": "user",
                "content": [{"type": "input_text", "text": prompt}],
            }
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "forecast_recommendation_plan_adjustments",
                "strict": True,
                "schema": {
                    "type": "object",
                    "properties": {
                        "actions": {
                            "type": "array",
                            "minItems": 1,
                            "maxItems": 8,
                            "items": {
                                "type": "object",
                                "properties": {
                                    "applianceId": {"type": "string", "minLength": 1, "maxLength": 64},
                                    "score": {"type": "number", "minimum": 0, "maximum": 100},
                                    "durationMultiplier": {"type": "number", "minimum": 0.5, "maximum": 3.0},
                                },
                                "required": ["applianceId", "score", "durationMultiplier"],
                                "additionalProperties": False,
                            },
                        }
                    },
                    "required": ["actions"],
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

    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            raw = response.read().decode("utf-8")

        payload = json.loads(raw)
        output_text = extract_response_output_text(payload)
        if not output_text:
            return {
                "used": False,
                "reason": "ai-empty-output",
                "scores": {},
                "durationMultipliers": {},
            }

        parsed = json.loads(output_text)
        if not isinstance(parsed, dict):
            return {
                "used": False,
                "reason": "ai-invalid-json",
                "scores": {},
                "durationMultipliers": {},
            }

        actions = parsed.get("actions")
        if not isinstance(actions, list):
            return {
                "used": False,
                "reason": "ai-invalid-actions",
                "scores": {},
                "durationMultipliers": {},
            }

        candidate_ids = {item["applianceId"] for item in candidate_rows}
        scores: dict[str, float] = {}
        duration_multipliers: dict[str, float] = {}

        for action in actions:
            if not isinstance(action, dict):
                continue

            appliance_id = str(action.get("applianceId") or "").strip()
            if appliance_id not in candidate_ids:
                continue

            score = parse_float(action.get("score"))
            duration_multiplier = parse_float(action.get("durationMultiplier"))

            if score is not None:
                scores[appliance_id] = max(0.0, min(score, 100.0))
            if duration_multiplier is not None:
                duration_multipliers[appliance_id] = max(0.5, min(duration_multiplier, 3.0))

        if not scores and not duration_multipliers:
            return {
                "used": False,
                "reason": "ai-no-usable-actions",
                "scores": {},
                "durationMultipliers": {},
            }

        return {
            "used": True,
            "reason": "ok",
            "model": PICOCLAW_MODEL,
            "scores": scores,
            "durationMultipliers": duration_multipliers,
            "candidateCount": len(candidate_rows),
        }
    except urllib.error.HTTPError as error:
        details = error.read().decode("utf-8", errors="replace")
        return {
            "used": False,
            "reason": f"ai-http-{error.code}",
            "error": details[:300],
            "scores": {},
            "durationMultipliers": {},
        }
    except urllib.error.URLError as error:
        return {
            "used": False,
            "reason": "ai-network-error",
            "error": str(error),
            "scores": {},
            "durationMultipliers": {},
        }
    except Exception as error:
        return {
            "used": False,
            "reason": "ai-unexpected-error",
            "error": str(error),
            "scores": {},
            "durationMultipliers": {},
        }
