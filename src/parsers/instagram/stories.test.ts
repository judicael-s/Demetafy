import { describe, it, expect } from 'vitest';
import { parseStories } from './stories.js';

describe('parseStories', () => {
  it('extracts uri, createdAt, title, sourceApp and sorts newest-first', () => {
    const stories = parseStories({
      ig_stories: [
        {
          uri: 'media/stories/202501/older.jpg',
          creation_timestamp: 1000,
          title: 'older',
          cross_post_source: { source_app: 'IG' },
        },
        {
          uri: 'media/stories/202501/newer.jpg',
          creation_timestamp: 2000,
          title: 'newer',
          cross_post_source: { source_app: 'FB' },
        },
      ],
    });
    expect(stories).toHaveLength(2);
    expect(stories[0]?.title).toBe('newer');
    expect(stories[0]?.sourceApp).toBe('FB');
    expect(stories[1]?.title).toBe('older');
    expect(stories[0]?.createdAt.getTime()).toBe(2_000_000);
  });

  it('de-mojibake’s story titles', () => {
    const stories = parseStories({
      ig_stories: [{ uri: 'media/stories/x.jpg', creation_timestamp: 1, title: 'cafÃ©' }],
    });
    expect(stories[0]?.title).toBe('café');
  });

  it('extracts device id from EXIF metadata when present', () => {
    const stories = parseStories({
      ig_stories: [
        {
          uri: 'x.jpg',
          creation_timestamp: 1,
          media_metadata: {
            photo_metadata: { exif_data: [{ device_id: 'android-abc' }] },
          },
        },
      ],
    });
    expect(stories[0]?.deviceId).toBe('android-abc');
  });

  it('returns empty array when ig_stories is missing', () => {
    expect(parseStories({})).toEqual([]);
  });

  it('throws on non-object root', () => {
    expect(() => parseStories([])).toThrow(/object root/);
  });

  it('skips entries without a uri', () => {
    const stories = parseStories({
      ig_stories: [{ creation_timestamp: 1 }, { uri: 'x.jpg', creation_timestamp: 2 }],
    });
    expect(stories).toHaveLength(1);
    expect(stories[0]?.uri).toBe('x.jpg');
  });
});
