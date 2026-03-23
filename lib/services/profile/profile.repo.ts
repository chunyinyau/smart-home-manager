import { DEMO_UID } from "@/lib/shared/constants";
import type { UserProfileRecord } from "./profile.types";

const profileByUser = new Map<string, UserProfileRecord>([
  [
    DEMO_UID,
    {
      uid: DEMO_UID,
      apartmentType: "Condominium",
      roomCount: 3,
      baselineKwh: 245,
      updatedAt: new Date().toISOString(),
    },
  ],
]);

export function getProfile(uid: string) {
  return profileByUser.get(uid) ?? null;
}

export function saveProfile(profile: UserProfileRecord) {
  const nextProfile = {
    ...profile,
    updatedAt: new Date().toISOString(),
  };
  profileByUser.set(profile.uid, nextProfile);
  return nextProfile;
}
