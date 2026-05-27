import { fixMojibake } from './encoding.js';

export interface Profile {
  username: string;
  displayName: string;
  email?: string;
  phone?: string;
  gender?: string;
  /** ISO date string "YYYY-MM-DD" from Meta. */
  dateOfBirth?: string;
  isPrivateAccount: boolean;
  profilePhotoUri?: string;
  profilePhotoTakenAt?: Date;
  countryCode?: string;
  firstStoryAt?: Date;
  lastStoryAt?: Date;
  lastLoginAt?: Date;
  lastLogoutAt?: Date;
  hasArchivedReels?: boolean;
  fbid?: string;
}

export interface ProfileChange {
  field: string;
  previousValue: string;
  newValue: string;
  changedAt: Date;
}

// ──────────────────────────────────────────────────────────────────────────
// personal_information.json (the email/phone/name/etc. record)
// ──────────────────────────────────────────────────────────────────────────

interface PersonalInfoString {
  value?: string;
  timestamp?: number;
}
interface PersonalInfoMedia {
  uri?: string;
  creation_timestamp?: number;
}
interface PersonalInfoUser {
  string_map_data?: Record<string, PersonalInfoString>;
  media_map_data?: Record<string, PersonalInfoMedia>;
}
interface PersonalInfoFile {
  profile_user?: PersonalInfoUser[];
}

// ──────────────────────────────────────────────────────────────────────────
// instagram_profile_information.json (account-level dates / settings)
// ──────────────────────────────────────────────────────────────────────────

interface IgLabelValue {
  label?: string;
  value?: string;
  timestamp_value?: number;
}
interface IgProfileFile {
  label_values?: IgLabelValue[];
  fbid?: string;
}

function tsToDate(seconds: number | undefined): Date | undefined {
  if (!seconds) return undefined;
  return new Date(seconds * 1000);
}

function findIgLabel(lvs: IgLabelValue[] | undefined, label: string): IgLabelValue | undefined {
  return lvs?.find((lv) => lv.label === label);
}

/**
 * Merge personal_information.json and instagram_profile_information.json
 * into a single Profile. Lenient: missing fields stay undefined.
 *
 * Pass `null` for either file if it's absent from the archive — both are
 * almost always present, but the parser shouldn't fault if one drifts away.
 */
export function parseProfile(personalInfo: unknown, igProfileInfo: unknown): Profile {
  const profile: Profile = {
    username: '',
    displayName: '',
    isPrivateAccount: false,
  };

  if (personalInfo && typeof personalInfo === 'object') {
    const user = (personalInfo as PersonalInfoFile).profile_user?.[0];
    const s = user?.string_map_data ?? {};
    const m = user?.media_map_data ?? {};

    profile.username = s['Username']?.value ?? '';
    profile.displayName = fixMojibake(s['Name']?.value ?? '');
    if (s['Email address']?.value) profile.email = s['Email address'].value;
    if (s['Phone number']?.value) profile.phone = s['Phone number'].value;
    if (s['Gender']?.value) profile.gender = s['Gender'].value;
    if (s['Date of birth']?.value) profile.dateOfBirth = s['Date of birth'].value;
    profile.isPrivateAccount = (s['Private account']?.value ?? 'False') === 'True';

    const photo = m['Profile photo'];
    if (photo?.uri) profile.profilePhotoUri = photo.uri;
    if (photo?.creation_timestamp) {
      profile.profilePhotoTakenAt = new Date(photo.creation_timestamp * 1000);
    }
  }

  if (igProfileInfo && typeof igProfileInfo === 'object') {
    const ig = igProfileInfo as IgProfileFile;
    const lvs = ig.label_values;
    const country = findIgLabel(lvs, 'First country code')?.value;
    if (country) profile.countryCode = country;
    const firstStory = tsToDate(findIgLabel(lvs, 'First story time')?.timestamp_value);
    if (firstStory) profile.firstStoryAt = firstStory;
    const lastStory = tsToDate(findIgLabel(lvs, 'Last story time')?.timestamp_value);
    if (lastStory) profile.lastStoryAt = lastStory;
    const lastLogin = tsToDate(findIgLabel(lvs, 'Last login')?.timestamp_value);
    if (lastLogin) profile.lastLoginAt = lastLogin;
    const lastLogout = tsToDate(findIgLabel(lvs, 'Last logout')?.timestamp_value);
    if (lastLogout) profile.lastLogoutAt = lastLogout;
    const archivedReels = findIgLabel(lvs, 'Do you have any archived Reels?')?.value;
    if (archivedReels) profile.hasArchivedReels = archivedReels === 'True';
    if (ig.fbid) profile.fbid = ig.fbid;
  }

  return profile;
}

interface ChangeEntry {
  string_map_data?: Record<string, { value?: string; timestamp?: number }>;
}
interface ProfileChangesFile {
  profile_profile_change?: ChangeEntry[];
}

/**
 * Parse `personal_information/personal_information/profile_changes.json`.
 * Tracks every renamed username, display name change, etc.
 */
export function parseProfileChanges(json: unknown): ProfileChange[] {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error('parseProfileChanges: expected object root');
  }
  const root = json as ProfileChangesFile;
  if (!Array.isArray(root.profile_profile_change)) return [];

  const out: ProfileChange[] = [];
  for (const raw of root.profile_profile_change) {
    const s = raw.string_map_data ?? {};
    const field = s['Changed']?.value;
    if (!field) continue;
    out.push({
      field,
      previousValue: fixMojibake(s['Previous value']?.value ?? ''),
      newValue: fixMojibake(s['New value']?.value ?? ''),
      changedAt: new Date((s['Change date']?.timestamp ?? 0) * 1000),
    });
  }
  return out.sort((a, b) => b.changedAt.getTime() - a.changedAt.getTime());
}
