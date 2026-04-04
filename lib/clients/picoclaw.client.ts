import type { RiskLevel } from "@/lib/shared/types";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_OPENAI_MODEL = process.env.PICOCLAW_MODEL ?? "gpt-5.4-mini";

export interface PicoClawForecastInput {
  month: string;
  budgetCap: number;
  sameMonthSpendTotal: number;
  sameMonthSpendHistoryCount: number;
  lastMonthCumulativeBill: number;
  averageDailySpend: number;
  projectedMonthEndSpend: number;
  daysRemaining: number;
  suggestedDaysToExceed: number | null;
  tariffCentsPerKwh: number;
  tariffMonthYear: string;
}

export interface PicoClawForecastAssessment {
  riskLevel: RiskLevel;
  daysToExceed: number | null;
  shortNarrative: string;
}

function deriveRiskLevel(projectedMonthEndSpend: number, budgetCap: number): RiskLevel {
  if (budgetCap <= 0) {
    return "CRITICAL";
  }

  const ratio = projectedMonthEndSpend / budgetCap;
  if (ratio >= 1) {
    return "CRITICAL";
  }
  if (ratio >= 0.85) {
    return "HIGH";
  }
  return "SAFE";
}

function fallbackForecastAssessment(
  input: PicoClawForecastInput,
): PicoClawForecastAssessment {
  const riskLevel = deriveRiskLevel(input.projectedMonthEndSpend, input.budgetCap);

  const delta = input.projectedMonthEndSpend - input.budgetCap;
  const direction = delta > 0 ? "above" : "within";
  const absDelta = Math.abs(delta);
  const narrative =
    riskLevel === "CRITICAL"
      ? `Projected spend is ${absDelta.toFixed(2)} SGD above budget. Reduce high-drain usage this week to avoid overrun.`
      : riskLevel === "HIGH"
        ? `Projected spend is close to the monthly cap. Keep daily usage steady to stay within budget.`
        : `Projected spend is within budget with buffer. Current consumption trend looks stable for this month.`;

  return {
    riskLevel,
    daysToExceed: input.suggestedDaysToExceed,
    shortNarrative:
      direction === "above" || riskLevel !== "SAFE"
        ? narrative
        : `${narrative} Estimated month-end spend remains ${absDelta.toFixed(2)} SGD under cap.`,
  };
}

function normalizeRiskLevel(value: unknown): RiskLevel | null {
  if (typeof value !== "string") {
    return null;
  }

  const upper = value.trim().toUpperCase();
  if (upper === "SAFE" || upper === "HIGH" || upper === "CRITICAL") {
    return upper;
  }

  return null;
}

function normalizeDaysToExceed(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return null;
  }

  return Math.ceil(numeric);
}

function extractOutputText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const direct = record.output_text;
  if (typeof direct === "string" && direct.trim().length > 0) {
    return direct;
  }

  const output = record.output;
  if (!Array.isArray(output)) {
    return null;
  }

  for (const item of output) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) {
      continue;
    }

    for (const part of content) {
      if (!part || typeof part !== "object") {
        continue;
      }

      const text = (part as Record<string, unknown>).text;
      if (typeof text === "string" && text.trim().length > 0) {
        return text;
      }
    }
  }

  return null;
}

function parseAssessment(outputText: string): PicoClawForecastAssessment | null {
  try {
    const parsed = JSON.parse(outputText) as Record<string, unknown>;
    const riskLevel = normalizeRiskLevel(parsed.risk_level);
    const shortNarrative = parsed.short_narrative;

    if (!riskLevel || typeof shortNarrative !== "string" || shortNarrative.trim().length < 8) {
      return null;
    }

    return {
      riskLevel,
      daysToExceed: normalizeDaysToExceed(parsed.days_to_exceed),
      shortNarrative: shortNarrative.trim(),
    };
  } catch {
    return null;
  }
}

async function generateViaOpenAI(
  input: PicoClawForecastInput,
): Promise<PicoClawForecastAssessment | null> {
  const apiKey = process.env.PICOCLAW_API_KEY;

  if (!apiKey) {
    return null;
  }

  const prompt = [
    "You are PicoClaw, an energy-budget forecasting assistant for Singapore households.",
    "Given ForecastBill input data, respond with JSON only.",
    "Do not include markdown.",
    "risk_level must be one of SAFE, HIGH, CRITICAL.",
    "days_to_exceed should be null when forecast stays within budget.",
    "short_narrative must be a concise and practical sentence under 180 characters.",
    "Input:",
    JSON.stringify(input),
  ].join("\n");

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: DEFAULT_OPENAI_MODEL,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: prompt,
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "forecast_bill_assessment",
          strict: true,
          schema: {
            type: "object",
            properties: {
              risk_level: {
                type: "string",
                enum: ["SAFE", "HIGH", "CRITICAL"],
              },
              days_to_exceed: {
                anyOf: [
                  {
                    type: "integer",
                    minimum: 0,
                  },
                  {
                    type: "null",
                  },
                ],
              },
              short_narrative: {
                type: "string",
                minLength: 8,
                maxLength: 180,
              },
            },
            required: ["risk_level", "days_to_exceed", "short_narrative"],
            additionalProperties: false,
          },
        },
      },
    }),
    signal: AbortSignal.timeout(12000),
  });

  const payload = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    const details =
      payload && typeof payload === "object"
        ? JSON.stringify(payload)
        : `HTTP ${response.status}`;
    throw new Error(`PicoClaw OpenAI call failed: ${details}`);
  }

  const outputText = extractOutputText(payload);
  if (!outputText) {
    throw new Error("PicoClaw OpenAI call succeeded but produced no text output.");
  }

  return parseAssessment(outputText);
}

export async function generateForecastReasoning(
  input: PicoClawForecastInput,
): Promise<PicoClawForecastAssessment> {
  try {
    const aiAssessment = await generateViaOpenAI(input);
    if (aiAssessment) {
      return aiAssessment;
    }
  } catch (error) {
    console.warn("PicoClaw AI forecast fallback activated:", error);
  }

  return fallbackForecastAssessment(input);
}
