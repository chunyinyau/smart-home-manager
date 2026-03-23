export type ApplianceState = "ON" | "OFF";

export interface ApplianceRecord {
  id: string;
  uid: string;
  name: string;
  room: string;
  type: string;
  state: ApplianceState;
  priority: number;
  currentWatts: number;
  kwhUsed: number;
  lastSeenAt: string;
}
