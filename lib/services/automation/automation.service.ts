import { getAppliances, shutdownAppliance } from "@/lib/services/appliance/appliance.service";
import { logHistory } from "@/lib/services/history/history.service";
import type { AutomationResult } from "./automation.types";

export async function shutdownLowestPriorityAppliance(uid: string): Promise<AutomationResult> {
  const appliances = (await getAppliances(uid))
    .filter((appliance) => appliance.state === "ON")
    .sort((left, right) => right.priority - left.priority);

  const candidate = appliances[0] ?? null;
  if (!candidate) {
    return {
      action: "none",
      appliance: null,
      message: "No active appliance was available for shutdown.",
    };
  }

  const updated = await shutdownAppliance(candidate.id);
  if (!updated) {
    return {
      action: "none",
      appliance: null,
      message: "Shutdown failed because the appliance could not be found.",
    };
  }

  await logHistory(uid, `Automation service shut down ${updated.name} based on lowest priority.`);

  return {
    action: "shutdown",
    appliance: updated,
    message: `${updated.name} was shut down based on lowest priority.`,
  };
}
