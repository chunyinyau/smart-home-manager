import type { ApplianceRecord } from "@/lib/services/appliance/appliance.types";

export interface AutomationResult {
  action: "shutdown" | "none";
  appliance: ApplianceRecord | null;
  message: string;
}
