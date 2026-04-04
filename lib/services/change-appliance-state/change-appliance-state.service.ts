import {
  extractErrorMessage,
  fetchService,
  readJsonBody,
} from "@/lib/clients/service-discovery";
import { DEMO_UID } from "@/lib/shared/constants";

export interface ChangeApplianceStateResult {
  success?: boolean;
  error?: string;
  confirmation_text?: string;
  changed_appliances?: Array<{
    id?: string;
    name?: string;
    state?: string;
    currentWatts?: number;
  }>;
  forecast?: {
    riskLevel?: string;
    projectedCost?: number;
    shortNarrative?: string;
  } | null;
  automator?: unknown;
}

async function readChangeApplianceStateError(response: Response): Promise<string> {
  const payload = await readJsonBody<Record<string, unknown>>(response);
  return extractErrorMessage(payload, "Change appliance state composite returned an error");
}

export async function changeApplianceState(params: {
  uid?: string;
  aid?: string;
  targetState?: "OFF" | "ON";
}): Promise<ChangeApplianceStateResult> {
  const applianceIds = params.aid ? [params.aid] : undefined;

  const response = await fetchService(
    "changeappliancestate",
    "/api/change-appliance-state",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        uid: params.uid ?? DEMO_UID,
        appliance_ids: applianceIds,
        target_state: params.targetState ?? "OFF",
      }),
      timeoutMs: 12000,
    },
  );

  if (!response.ok) {
    throw new Error(await readChangeApplianceStateError(response));
  }

  return (await response.json()) as ChangeApplianceStateResult;
}
