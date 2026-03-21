import {
  getApplianceById,
  listAppliancesByUser,
  updateAppliancePriority,
  updateApplianceState,
} from "./appliance.repo";

export function getAppliances(uid: string) {
  return listAppliancesByUser(uid);
}

export function getAppliance(aid: string) {
  return getApplianceById(aid);
}

export function shutdownAppliance(aid: string) {
  return updateApplianceState(aid, "OFF", 0);
}

export function setAppliancePriority(aid: string, priority: number) {
  return updateAppliancePriority(aid, priority);
}

export function getUsageSummary(uid: string) {
  const appliances = listAppliancesByUser(uid);
  const activeCount = appliances.filter((appliance) => appliance.state === "ON").length;
  const totalWatts = appliances.reduce((sum, appliance) => sum + appliance.currentWatts, 0);
  const totalKwh = appliances.reduce((sum, appliance) => sum + appliance.kwhUsed, 0);

  return {
    activeCount,
    totalWatts,
    totalKwh,
  };
}
