import { fixMojibake } from './encoding.js';

export interface SavedItem {
  url: string;
  caption: string;
  savedAt: Date;
  /** Names of collections this item is filed under (populated by linkItemsToCollections). */
  collections: string[];
}

export interface SavedCollection {
  name: string;
  type: string; // observed: "Default"
  privacy: string; // observed: "Private"
  createdAt: Date;
  updatedAt: Date;
  itemUrls: string[];
}

/**
 * Meta's DYI uses a verbose "label/value" shape rather than direct keys:
 *
 *   { "label_values": [
 *       { "label": "URL", "value": "...", "href": "..." },
 *       { "label": "Caption", "value": "..." }
 *   ] }
 *
 * `dict` wraps nested objects (used inside collections to list items).
 */
interface LabelValue {
  label?: string;
  value?: string;
  href?: string;
  timestamp_value?: number;
  dict?: NestedDict[];
}
interface NestedDict {
  dict?: LabelValue[];
}
interface RawEntry {
  timestamp?: number;
  label_values?: LabelValue[];
}

function findLabel(lvs: LabelValue[] | undefined, label: string): LabelValue | undefined {
  return lvs?.find((lv) => lv.label === label);
}

function unixToDate(seconds: number | undefined): Date {
  return new Date((seconds ?? 0) * 1000);
}

/**
 * Parse `your_instagram_activity/saved/saved_posts.json` into a flat list of
 * SavedItem. The `collections` field is empty here; populate with
 * `linkItemsToCollections` after parsing collections.
 */
export function parseSavedPosts(json: unknown): SavedItem[] {
  if (!Array.isArray(json)) {
    throw new Error('saved_posts.json: expected root array');
  }
  const items: SavedItem[] = [];
  for (const raw of json as RawEntry[]) {
    const url = findLabel(raw.label_values, 'URL')?.value;
    if (!url) continue; // malformed entry — skip
    const caption = findLabel(raw.label_values, 'Caption')?.value ?? '';
    items.push({
      url,
      caption: fixMojibake(caption),
      savedAt: unixToDate(raw.timestamp),
      collections: [],
    });
  }
  return items;
}

/**
 * Parse `your_instagram_activity/saved/saved_collections.json`. Each collection
 * contains its members inline (via nested `dict` arrays), giving us the
 * item↔collection linkage that `saved_posts.json` lacks.
 */
export function parseSavedCollections(json: unknown): SavedCollection[] {
  if (!Array.isArray(json)) {
    throw new Error('saved_collections.json: expected root array');
  }
  const collections: SavedCollection[] = [];
  for (const raw of json as RawEntry[]) {
    const lvs = raw.label_values ?? [];
    const name = findLabel(lvs, 'Name')?.value;
    if (!name) continue;

    const type = findLabel(lvs, 'Type')?.value ?? 'Default';
    const privacy = findLabel(lvs, 'Privacy')?.value ?? 'Private';
    const updatedAt = unixToDate(findLabel(lvs, 'Update time')?.timestamp_value);

    const itemUrls: string[] = [];
    for (const lv of lvs) {
      if (!lv.dict) continue;
      for (const wrapper of lv.dict) {
        const innerUrl = findLabel(wrapper.dict, 'URL')?.value;
        if (innerUrl) itemUrls.push(innerUrl);
      }
    }

    collections.push({
      name: fixMojibake(name),
      type,
      privacy,
      createdAt: unixToDate(raw.timestamp),
      updatedAt,
      itemUrls,
    });
  }
  return collections;
}

/** Annotate each item with the collection names it belongs to. Pure / no mutation. */
export function linkItemsToCollections(
  items: SavedItem[],
  collections: SavedCollection[],
): SavedItem[] {
  const urlToCollections = new Map<string, string[]>();
  for (const c of collections) {
    for (const url of c.itemUrls) {
      const existing = urlToCollections.get(url) ?? [];
      existing.push(c.name);
      urlToCollections.set(url, existing);
    }
  }
  return items.map((item) => ({
    ...item,
    collections: urlToCollections.get(item.url) ?? [],
  }));
}
