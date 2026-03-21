import type { TelegramIntent } from "@/lib/shared/types";

export function parseIntent(value: string): TelegramIntent | null {
  const normalized = value.trim().toLowerCase();
  const supportedIntents: TelegramIntent[] = [
    "status",
    "forecast",
    "set_budget",
    "shutdown",
    "history",
    "profile",
    "rate",
  ];

  return supportedIntents.includes(normalized as TelegramIntent)
    ? (normalized as TelegramIntent)
    : null;
}
