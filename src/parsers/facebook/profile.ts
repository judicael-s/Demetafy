import { fixMojibake } from '../instagram/encoding.js';

export interface FacebookPreviousName {
  name: string;
  /** Seconds since epoch; 0 if absent. */
  timestamp: number;
}

/**
 * Facebook profile, parsed from `profile_information.json` (`profile_v2`).
 * Unlike Instagram there is no handle/username — Facebook identifies users by
 * real name. Lenient: missing fields stay undefined / empty.
 */
export interface FacebookProfile {
  fullName: string;
  firstName: string;
  lastName: string;
  emails: string[];
  /** ISO "YYYY-MM-DD" derived from the birthday parts; undefined if not set. */
  dateOfBirth?: string;
  gender?: string;
  currentCity?: string;
  hometown?: string;
  relationshipStatus?: string;
  previousNames: FacebookPreviousName[];
}

interface RawNamePart {
  full_name?: string;
  first_name?: string;
  middle_name?: string;
  last_name?: string;
}
interface RawTimestampedName {
  name?: string;
  timestamp?: number;
}
interface RawProfileV2 {
  name?: RawNamePart;
  emails?: { emails?: unknown[] };
  birthday?: { year?: number; month?: number; day?: number };
  gender?: { gender_option?: string; pronoun?: string };
  current_city?: { name?: string };
  hometown?: { name?: string };
  relationship?: { status?: string };
  previous_names?: RawTimestampedName[];
}
interface RawProfileFile {
  profile_v2?: RawProfileV2;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

export function parseFacebookProfile(json: unknown): FacebookProfile {
  const profile: FacebookProfile = {
    fullName: '',
    firstName: '',
    lastName: '',
    emails: [],
    previousNames: [],
  };
  if (!json || typeof json !== 'object') return profile;
  const p = (json as RawProfileFile).profile_v2;
  if (!p) return profile;

  if (p.name) {
    profile.fullName = fixMojibake(p.name.full_name ?? '');
    profile.firstName = fixMojibake(p.name.first_name ?? '');
    profile.lastName = fixMojibake(p.name.last_name ?? '');
  }

  if (Array.isArray(p.emails?.emails)) {
    profile.emails = p.emails!.emails!.filter((e): e is string => typeof e === 'string');
  }

  const b = p.birthday;
  if (b && typeof b.year === 'number' && b.year > 0 && typeof b.month === 'number' && typeof b.day === 'number') {
    profile.dateOfBirth = `${b.year}-${pad2(b.month)}-${pad2(b.day)}`;
  }

  if (p.gender?.gender_option) profile.gender = p.gender.gender_option;
  if (p.current_city?.name) profile.currentCity = fixMojibake(p.current_city.name);
  if (p.hometown?.name) profile.hometown = fixMojibake(p.hometown.name);
  if (p.relationship?.status) profile.relationshipStatus = fixMojibake(p.relationship.status);

  for (const pn of p.previous_names ?? []) {
    if (typeof pn.name === 'string') {
      profile.previousNames.push({ name: fixMojibake(pn.name), timestamp: pn.timestamp ?? 0 });
    }
  }

  return profile;
}
