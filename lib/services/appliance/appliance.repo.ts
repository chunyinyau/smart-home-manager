import { DEMO_UID } from "@/lib/shared/constants";
import type { ApplianceRecord, ApplianceState } from "./appliance.types";

const appliances: ApplianceRecord[] = [
  {
    id: "app_1",
    uid: DEMO_UID,
    name: "Main AC",
    room: "Living Room",
    type: "Cooling",
    state: "ON",
    priority: 1,
    currentWatts: 2500,
    kwhUsed: 84.5,
    lastSeenAt: new Date().toISOString(),
  },
  {
    id: "app_2",
    uid: DEMO_UID,
    name: "Server Rack",
    room: "Study",
    type: "Essential",
    state: "ON",
    priority: 1,
    currentWatts: 800,
    kwhUsed: 52.3,
    lastSeenAt: new Date().toISOString(),
  },
  {
    id: "app_3",
    uid: DEMO_UID,
    name: "Entertainment Unit",
    room: "Living Room",
    type: "Non-Essential",
    state: "ON",
    priority: 3,
    currentWatts: 450,
    kwhUsed: 23.1,
    lastSeenAt: new Date().toISOString(),
  },
  {
    id: "app_4",
    uid: DEMO_UID,
    name: "Desk Lamp",
    room: "Study",
    type: "Non-Essential",
    state: "ON",
    priority: 4,
    currentWatts: 60,
    kwhUsed: 4.9,
    lastSeenAt: new Date().toISOString(),
  },
];

export function listAppliancesByUser(uid: string) {
  return appliances.filter((appliance) => appliance.uid === uid);
}

export function getApplianceById(aid: string) {
  return appliances.find((appliance) => appliance.id === aid) ?? null;
}

export function updateApplianceState(aid: string, state: ApplianceState, watts: number) {
  const appliance = getApplianceById(aid);
  if (!appliance) {
    return null;
  }

  appliance.state = state;
  appliance.currentWatts = watts;
  appliance.lastSeenAt = new Date().toISOString();
  return appliance;
}

export function updateAppliancePriority(aid: string, priority: number) {
  const appliance = getApplianceById(aid);
  if (!appliance) {
    return null;
  }

  appliance.priority = priority;
  appliance.lastSeenAt = new Date().toISOString();
  return appliance;
}
