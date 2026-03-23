import { getProfile, saveProfile } from "./profile.repo";

export function getUserProfile(uid: string) {
  return getProfile(uid);
}

export function updateBaseline(uid: string, baselineKwh: number) {
  const profile = getProfile(uid);
  if (!profile) {
    return null;
  }

  return saveProfile({
    ...profile,
    baselineKwh,
  });
}
