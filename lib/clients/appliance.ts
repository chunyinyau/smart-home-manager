import type { ApplianceRecord } from "@/lib/services/appliance/appliance.types";
import {
  extractErrorMessage,
  fetchService,
  readJsonBody,
} from "@/lib/clients/service-discovery";

async function readErrorMessage(response: Response) {
  const payload = await readJsonBody<Record<string, unknown>>(response);
  return extractErrorMessage(payload, "Appliance microservice returned an error");
}

export async function fetchAppliances(uid: string): Promise<ApplianceRecord[]> {
  const response = await fetchService(
    "appliance",
    `/api/appliance?uid=${encodeURIComponent(uid)}`,
  );

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return (await response.json()) as ApplianceRecord[];
}

export async function fetchAppliance(aid: string): Promise<ApplianceRecord | null> {
  const response = await fetchService(
    "appliance",
    `/api/appliance/${encodeURIComponent(aid)}`,
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return (await response.json()) as ApplianceRecord;
}

export async function shutdownApplianceInService(aid: string): Promise<ApplianceRecord | null> {
  const response = await fetchService(
    "appliance",
    `/api/appliance/${encodeURIComponent(aid)}/shutdown`,
    {
      method: "POST",
    },
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return (await response.json()) as ApplianceRecord;
}

export async function updateAppliancePriorityInService(
  aid: string,
  priority: number,
): Promise<ApplianceRecord | null> {
  const response = await fetchService(
    "appliance",
    `/api/appliance/${encodeURIComponent(aid)}/priority`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ priority }),
    },
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return (await response.json()) as ApplianceRecord;
}
