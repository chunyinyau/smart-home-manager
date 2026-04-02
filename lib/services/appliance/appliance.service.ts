import {
  fetchAppliance,
  fetchAppliances,
  shutdownApplianceInService,
  updateAppliancePriorityInService,
} from "@/lib/clients/appliance";

export async function getAppliances(uid: string) {
  return fetchAppliances(uid);
}

export async function getAppliance(aid: string) {
  return fetchAppliance(aid);
}

export async function shutdownAppliance(aid: string) {
  return shutdownApplianceInService(aid);
}

export async function setAppliancePriority(aid: string, priority: number) {
  return updateAppliancePriorityInService(aid, priority);
}

export async function getUsageSummary(uid: string) {
  const appliances = await fetchAppliances(uid);
  const activeCount = appliances.filter((appliance) => appliance.state === "ON").length;
  const totalWatts = appliances.reduce((sum, appliance) => sum + appliance.currentWatts, 0);
  const totalKwh = appliances.reduce((sum, appliance) => sum + appliance.kwhUsed, 0);

  return {
    activeCount,
    totalWatts,
    totalKwh,
  };
}
