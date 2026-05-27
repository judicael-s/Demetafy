import { describe, it, expect } from 'vitest';
import {
  parseSavedPosts,
  parseSavedCollections,
  linkItemsToCollections,
} from './saved.js';

describe('parseSavedPosts', () => {
  it('extracts items from the label/value shape and de-mojibake’s captions', () => {
    const items = parseSavedPosts([
      {
        timestamp: 1700000000,
        media: [],
        label_values: [
          {
            label: 'URL',
            value: 'https://www.instagram.com/reel/ABC/',
            href: 'https://www.instagram.com/reel/ABC/',
          },
          { label: 'Caption', value: 'aimÃ©' },
        ],
      },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      url: 'https://www.instagram.com/reel/ABC/',
      caption: 'aimé',
      collections: [],
    });
    expect(items[0]?.savedAt.getTime()).toBe(1700000000 * 1000);
  });

  it('skips entries without a URL rather than throwing', () => {
    const items = parseSavedPosts([
      { timestamp: 0, label_values: [{ label: 'Caption', value: 'no url' }] },
    ]);
    expect(items).toHaveLength(0);
  });

  it('throws on a non-array root', () => {
    expect(() => parseSavedPosts({ items: [] })).toThrow(/expected root array/);
  });
});

describe('parseSavedCollections', () => {
  it('extracts metadata and the nested member item URLs', () => {
    const cols = parseSavedCollections([
      {
        timestamp: 1700000000,
        label_values: [
          { label: 'Name', value: 'reels' },
          { label: 'Type', value: 'Default' },
          { label: 'Privacy', value: 'Private' },
          { label: 'Update time', timestamp_value: 1700001000 },
          {
            dict: [
              { dict: [{ label: 'URL', value: 'https://www.instagram.com/reel/A/' }] },
              { dict: [{ label: 'URL', value: 'https://www.instagram.com/reel/B/' }] },
            ],
          },
        ],
      },
    ]);
    expect(cols).toHaveLength(1);
    expect(cols[0]?.name).toBe('reels');
    expect(cols[0]?.itemUrls).toEqual([
      'https://www.instagram.com/reel/A/',
      'https://www.instagram.com/reel/B/',
    ]);
    expect(cols[0]?.updatedAt.getTime()).toBe(1700001000 * 1000);
  });

  it('de-mojibake’s collection names', () => {
    const cols = parseSavedCollections([
      {
        timestamp: 0,
        label_values: [{ label: 'Name', value: 'cafÃ©' }],
      },
    ]);
    expect(cols[0]?.name).toBe('café');
  });
});

describe('linkItemsToCollections', () => {
  it('annotates items with every collection containing them', () => {
    const items = [
      { url: 'A', caption: '', savedAt: new Date(0), collections: [] },
      { url: 'B', caption: '', savedAt: new Date(0), collections: [] },
    ];
    const collections = [
      {
        name: 'reels',
        type: 'Default',
        privacy: 'Private',
        createdAt: new Date(0),
        updatedAt: new Date(0),
        itemUrls: ['A'],
      },
      {
        name: 'fav',
        type: 'Default',
        privacy: 'Private',
        createdAt: new Date(0),
        updatedAt: new Date(0),
        itemUrls: ['A', 'B'],
      },
    ];
    const linked = linkItemsToCollections(items, collections);
    expect(linked[0]?.collections).toEqual(['reels', 'fav']);
    expect(linked[1]?.collections).toEqual(['fav']);
  });

  it('leaves items without a matching collection with an empty array', () => {
    const items = [{ url: 'X', caption: '', savedAt: new Date(0), collections: [] }];
    const linked = linkItemsToCollections(items, []);
    expect(linked[0]?.collections).toEqual([]);
  });
});
