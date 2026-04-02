import type { ApplianceRecord } from "@/lib/services/appliance/appliance.types";

const APPLIANCE_SERVICE_URL =
  process.env.APPLIANCE_SERVICE_URL ?? "http://127.0.0.1:5002";

function buildApplianceUrl(path: string) {
  return `${APPLIANCE_SERVICE_URL}${path}`;
}

async function readErrorMessage(response: Response) {
  try {
    const payload = (await response.json()) as { error?: string; message?: string };
    return payload.error ?? payload.message ?? null;
  } catch {
    return null;
  }
}

export async function fetchAppliances(uid: string): Promise<ApplianceRecord[]> {
  const response = await fetch(buildApplianceUrl(`/api/appliance?uid=${encodeURIComponent(uid)}`), {
    cache: "no-store",
  });

  if (!response.ok) {
    const message = await readErrorMessage(response);
    throw new Error(message ?? "Appliance microservice returned an error");
  }

  return (await response.json()) as ApplianceRecord[];
}

export async function fetchAppliance(aid: string): Promise<ApplianceRecord | null> {
  const response = await fetch(buildApplianceUrl(`/api/appliance/${encodeURIComponent(aid)}`), {
    cache: "no-store",
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const message = await readErrorMessage(response);
    throw new Error(message ?? "Appliance microservice returned an error");
  }

  return (await response.json()) as ApplianceRecord;
}

export async function shutdownApplianceInService(aid: string): Promise<ApplianceRecord | null> {
  const response = await fetch(
    buildApplianceUrl(`/api/appliance/${encodeURIComponent(aid)}/shutdown`),
    {
      method: "POST",
      cache: "no-store",
    },
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const message = await readErrorMessage(response);
    throw new Error(message ?? "Appliance microservice returned an error");
  }

  return (await response.json()) as ApplianceRecord;
}

export async function updateAppliancePriorityInService(
  aid: string,
  priority: number,
): Promise<ApplianceRecord | null> {
  const response = await fetch(
    buildApplianceUrl(`/api/appliance/${encodeURIComponent(aid)}/priority`),
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ priority }),
      cache: "no-store",
    },
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const message = await readErrorMessage(response);
    throw new Error(message ?? "Appliance microservice returned an error");
  }

  return (await response.json()) as ApplianceRecord;
}
