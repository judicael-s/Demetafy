import { fixMojibake } from './encoding.js';

export interface Story {
  /** Archive-relative media path, e.g. "media/stories/202501/<id>.jpg" */
  uri: string;
  createdAt: Date;
  /** User-set story caption / title (often empty). Mojibake-fixed. */
  title: string;
  /** Where the story was cross-posted from, if any (e.g. "FB"). */
  sourceApp?: string;
  /** EXIF-derived device id when available. */
  deviceId?: string;
}

interface RawStory {
  uri?: string;
  creation_timestamp?: number;
  title?: string;
  cross_post_source?: { source_app?: string };
  media_metadata?: {
    photo_metadata?: { exif_data?: Array<{ device_id?: string }> };
  };
}

interface RawStoriesFile {
  ig_stories?: RawStory[];
}

/**
 * Parse `your_instagram_activity/media/stories.json`.
 * Sorts newest-first (Meta's order in the file is already newest-first but
 * we re-sort defensively in case that changes).
 */
export function parseStories(json: unknown): Story[] {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error('parseStories: expected object root with ig_stories');
  }
  const root = json as RawStoriesFile;
  if (!Array.isArray(root.ig_stories)) return [];

  const out: Story[] = [];
  for (const raw of root.ig_stories) {
    if (typeof raw.uri !== 'string') continue;
    const story: Story = {
      uri: raw.uri,
      createdAt: new Date((raw.creation_timestamp ?? 0) * 1000),
      title: fixMojibake(raw.title ?? ''),
    };
    if (raw.cross_post_source?.source_app) {
      story.sourceApp = raw.cross_post_source.source_app;
    }
    const exif = raw.media_metadata?.photo_metadata?.exif_data?.[0];
    if (exif?.device_id) story.deviceId = exif.device_id;
    out.push(story);
  }
  return out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
