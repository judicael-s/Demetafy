import { describe, it, expect } from 'vitest';
import { parseReposts } from './reposts.js';

function buildRepost(opts: {
  timestamp: number;
  expiry: number;
  text: string;
  url: string;
  caption: string;
  ownerName: string;
  ownerUsername: string;
  fbid?: string;
}) {
  const r: Record<string, unknown> = {
    timestamp: opts.timestamp,
    label_values: [
      { label: 'Text', value: opts.text },
      { label: 'Expiry time', timestamp_value: opts.expiry },
      {
        title: 'Media',
        dict: [
          {
            title: '',
            dict: [
              { label: 'URL', value: opts.url, href: opts.url },
              { label: 'Caption', value: opts.caption },
              { label: 'Title', value: '' },
              {
                title: 'Owner',
                dict: [
                  {
                    title: '',
                    dict: [
                      { label: 'URL', value: '' },
                      { label: 'Name', value: opts.ownerName },
                      { label: 'Username', value: opts.ownerUsername },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  if (opts.fbid) r['fbid'] = opts.fbid;
  return r;
}

describe('parseReposts', () => {
  it('extracts repost metadata + source URL/caption/owner', () => {
    const reposts = parseReposts([
      buildRepost({
        timestamp: 1700000000,
        expiry: 4900000000,
        text: 'great post',
        url: 'https://www.instagram.com/p/ABC/',
        caption: 'original caption',
        ownerName: 'Original Author',
        ownerUsername: 'orig',
        fbid: '12345',
      }),
    ]);
    expect(reposts).toHaveLength(1);
    expect(reposts[0]).toMatchObject({
      repostedAt: new Date(1700000000 * 1000),
      expiresAt: new Date(4900000000 * 1000),
      userText: 'great post',
      fbid: '12345',
      source: {
        url: 'https://www.instagram.com/p/ABC/',
        caption: 'original caption',
        ownerName: 'Original Author',
        ownerUsername: 'orig',
      },
    });
  });

  it('de-mojibake’s captions, owner names, and user text', () => {
    const reposts = parseReposts([
      buildRepost({
        timestamp: 1,
        expiry: 2,
        text: 'aimÃ©',
        url: 'https://x.com/p/A/',
        caption: 'didnât',
        ownerName: 'cafÃ©',
        ownerUsername: 'cafe',
      }),
    ]);
    expect(reposts[0]?.userText).toBe('aimé');
    expect(reposts[0]?.source.caption).toBe('didn’t');
    expect(reposts[0]?.source.ownerName).toBe('café');
  });

  it('sorts newest-first', () => {
    const reposts = parseReposts([
      buildRepost({
        timestamp: 1000,
        expiry: 9999,
        text: '',
        url: 'https://x/p/A/',
        caption: 'older',
        ownerName: 'o',
        ownerUsername: 'o',
      }),
      buildRepost({
        timestamp: 2000,
        expiry: 9999,
        text: '',
        url: 'https://x/p/B/',
        caption: 'newer',
        ownerName: 'o',
        ownerUsername: 'o',
      }),
    ]);
    expect(reposts[0]?.source.caption).toBe('newer');
  });

  it('skips entries with no source URL', () => {
    const reposts = parseReposts([
      buildRepost({
        timestamp: 1,
        expiry: 2,
        text: '',
        url: '',
        caption: '',
        ownerName: '',
        ownerUsername: '',
      }),
    ]);
    expect(reposts).toHaveLength(0);
  });

  it('throws on non-array root', () => {
    expect(() => parseReposts({})).toThrow(/root array/);
  });
});
