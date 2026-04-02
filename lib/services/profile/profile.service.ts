import { DEMO_UID } from "@/lib/shared/constants";

interface ProfileRecord {
  uid: string;
  homeType: string;
  occupants: number;
  baselineKwh: number;
}

const profileByUser = new Map<string, ProfileRecord>([
  [
    DEMO_UID,
    {
      uid: DEMO_UID,
      homeType: "HDB 4-Room",
      occupants: 3,
      baselineKwh: 420,
    },
  ],
]);

export function getUserProfile(uid: string) {
  return profileByUser.get(uid) ?? null;
}
