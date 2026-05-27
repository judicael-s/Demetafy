import { fixMojibake } from './encoding.js';

export interface Repost {
  repostedAt: Date;
  /** Meta auto-sets a far-future expiry on reposts. Often 100+ years out. */
  expiresAt: Date;
  /** Alex' own text added to the repost (often empty). Mojibake-fixed. */
  userText: string;
  source: RepostSource;
  fbid?: string;
}

export interface RepostSource {
  url: string;
  caption: string;
  title: string;
  ownerName: string;
  ownerUsername: string;
}

interface LabelValue {
  label?: string;
  value?: string;
  href?: string;
  timestamp_value?: number;
  title?: string;
  dict?: NestedDict[];
}
interface NestedDict {
  dict?: LabelValue[];
  title?: string;
}
interface RawRepost {
  timestamp?: number;
  fbid?: string;
  label_values?: LabelValue[];
}

function findLabel(lvs: LabelValue[] | undefined, label: string): LabelValue | undefined {
  return lvs?.find((lv) => lv.label === label);
}
function findGroup(lvs: LabelValue[] | undefined, title: string): LabelValue | undefined {
  return lvs?.find((lv) => lv.title === title);
}

function parseSource(lvs: LabelValue[] | undefined): RepostSource {
  // label_values has a `dict` entry titled "Media" → containing a nested dict
  // with URL/Caption/Title/Hashtags/Owner. Owner is itself another nested dict
  // with URL/Name/Username.
  const mediaGroup = findGroup(lvs, 'Media');
  const inner = mediaGroup?.dict?.[0]?.dict;
  const url = findLabel(inner, 'URL')?.value ?? '';
  const caption = findLabel(inner, 'Caption')?.value ?? '';
  const title = findLabel(inner, 'Title')?.value ?? '';
  const ownerGroup = inner?.find((lv) => lv.title === 'Owner');
  const ownerInner = ownerGroup?.dict?.[0]?.dict;
  const ownerName = findLabel(ownerInner, 'Name')?.value ?? '';
  const ownerUsername = findLabel(ownerInner, 'Username')?.value ?? '';

  return {
    url,
    caption: fixMojibake(caption),
    title: fixMojibake(title),
    ownerName: fixMojibake(ownerName),
    ownerUsername,
  };
}

/**
 * Parse `your_instagram_activity/media/reposts.json`. Returns newest-first.
 *
 * Reposts have a nested label/value/dict structure: each entry holds
 * Alex' own text + a "Media" group containing the original post's URL,
 * caption, and owner. Returns empty array on missing/empty file.
 */
export function parseReposts(json: unknown): Repost[] {
  if (!Array.isArray(json)) {
    throw new Error('parseReposts: expected root array');
  }
  const out: Repost[] = [];
  for (const raw of json as RawRepost[]) {
    const source = parseSource(raw.label_values);
    if (!source.url) continue; // malformed
    const userText = findLabel(raw.label_values, 'Text')?.value ?? '';
    const expirySecs = findLabel(raw.label_values, 'Expiry time')?.timestamp_value ?? 0;
    const repost: Repost = {
      repostedAt: new Date((raw.timestamp ?? 0) * 1000),
      expiresAt: new Date(expirySecs * 1000),
      userText: fixMojibake(userText),
      source,
    };
    if (raw.fbid) repost.fbid = raw.fbid;
    out.push(repost);
  }
  return out.sort((a, b) => b.repostedAt.getTime() - a.repostedAt.getTime());
}
