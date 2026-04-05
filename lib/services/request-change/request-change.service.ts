import {
  extractErrorMessage,
  fetchService,
  readJsonBody,
} from "@/lib/clients/service-discovery";
import { DEMO_UID } from "@/lib/shared/constants";

export interface RequestChangeResult {
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

async function readRequestChangeError(response: Response): Promise<string> {
  const payload = await readJsonBody<Record<string, unknown>>(response);
  return extractErrorMessage(payload, "Request change composite returned an error");
}

export async function requestChange(params: {
  uid?: string;
  aid?: string;
  targetState?: "OFF" | "ON";
}): Promise<RequestChangeResult> {
  const applianceIds = params.aid ? [params.aid] : undefined;

  const response = await fetchService(
    "requestchange",
    "/api/request-change",
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
