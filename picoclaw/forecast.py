import json
import logging
import os
import sys
import urllib.error
import urllib.request
from typing import Any

OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"
DEFAULT_MODEL = os.getenv("PICOCLAW_MODEL", "gpt-5.4-mini")
logger = logging.getLogger(__name__)


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


def run_forecast_check(input_payload: dict[str, Any]) -> dict[str, Any]:
    api_key, api_key_source = _resolve_api_key()
    if not api_key:
        raise RuntimeError("Missing PicoClaw API key")

    logger.info(
        "Using %s ending in ...%s with model %s",
        api_key_source,
        api_key[-4:] if len(api_key) >= 4 else api_key,
        DEFAULT_MODEL,
    )

    prompt = "\n".join(
        [
            "You are PicoClaw, an energy budget forecasting assistant.",
            "Return JSON only with keys: risk_level, days_to_exceed, short_narrative.",
            "risk_level must be SAFE, HIGH, or CRITICAL.",
            "days_to_exceed must be integer >= 0 or null.",
            "short_narrative should be concise and actionable.",
            "Input:",
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
                "name": "forecast_bill_assessment",
                "strict": True,
                "schema": {
                    "type": "object",
                    "properties": {
                        "risk_level": {
                            "type": "string",
                            "enum": ["SAFE", "HIGH", "CRITICAL"],
                        },
                        "days_to_exceed": {
                            "anyOf": [
                                {"type": "integer", "minimum": 0},
                                {"type": "null"},
                            ]
                        },
                        "short_narrative": {
                            "type": "string",
                            "minLength": 8,
                            "maxLength": 180,
                        },
                    },
                    "required": ["risk_level", "days_to_exceed", "short_narrative"],
                    "additionalProperties": False,
                },
            }
        },
    }

    request = urllib.request.Request(
        OPENAI_RESPONSES_URL,
        data=json.dumps(request_body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        details = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"OpenAI HTTP {error.code}: {details}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"OpenAI request failed: {error}") from error

    payload = json.loads(raw)
    output_text = _extract_output_text(payload)
    if not output_text:
        raise RuntimeError("OpenAI response did not include output text")

    try:
        parsed = json.loads(output_text)
    except json.JSONDecodeError as error:
        raise RuntimeError("OpenAI output was not valid JSON") from error

    return {
        "input": input_payload,
        "assessment": parsed,
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
