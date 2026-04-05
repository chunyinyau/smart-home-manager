import {
  extractErrorMessage,
  fetchService,
  readJsonBody,
} from "@/lib/clients/service-discovery";
import { fetchPublicEndpoint } from "@/lib/clients/public-endpoints";
import { DEMO_UID } from "@/lib/shared/constants";

export interface RequestChangeResult {
  success?: boolean;
  error?: string;
  confirmation_text?: string;
  duration_minutes?: number | null;
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
  durationMinutes?: number;
}): Promise<RequestChangeResult> {
  const applianceIds = params.aid ? [params.aid] : undefined;
  const payload = {
    uid: params.uid ?? DEMO_UID,
    appliance_ids: applianceIds,
    target_state: params.targetState ?? "OFF",
    duration_minutes: params.durationMinutes,
  };

  const publicResponse = await fetchPublicEndpoint(
    [
      "OPENCLAW_REQUEST_CHANGE_URL",
      "REQUEST_CHANGE_PUBLIC_URL",
      "OPENCLAW_CHANGE_APPLIANCE_STATE_URL",
      "CHANGE_APPLIANCE_STATE_PUBLIC_URL",
    ],
    {},
    {
      method: "POST",
      body: payload,
      timeoutMs: 12000,
    },
  );

  if (publicResponse) {
    if (!publicResponse.ok) {
      throw new Error(await readRequestChangeError(publicResponse));
    }

    return (await publicResponse.json()) as RequestChangeResult;
  }

  const response = await fetchService(
    "requestchange",
    "/api/request-change",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...payload,
      }),
      timeoutMs: 12000,
    },
  );

  if (!response.ok) {
    throw new Error(await readRequestChangeError(response));
  }

  return (await response.json()) as RequestChangeResult;
}
