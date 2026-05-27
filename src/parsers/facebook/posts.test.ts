import { describe, it, expect } from 'vitest';
import { parseFacebookPosts } from './posts.js';

describe('parseFacebookPosts', () => {
  it('parses text/title/links/media and returns newest-first with mojibake fixed', () => {
    const json = [
      {
        timestamp: 1236082645,
        attachments: [{ data: [{ external_context: { url: 'http://example.com/blog' } }] }],
        data: [{ post: 'c mon blog !!! venez nombreux.' }, { update_timestamp: 1236082645 }],
        title: 'Alex Rivera a partagÃ© un lien.', // partagé
      },
      {
        timestamp: 1386163177,
        attachments: [
          { data: [{ media: { uri: 'your_facebook_activity/posts/media/x.png', creation_timestamp: 1386163100 } }] },
        ],
        data: [{ post: 'une pensÃ©e' }], // pensée
        title: '',
      },
    ];

    const posts = parseFacebookPosts(json);
    expect(posts).toHaveLength(2);

    // newest first
    expect(posts[0]?.timestamp).toBe(1386163177);
    expect(posts[0]?.text).toBe('une pensée');
    expect(posts[0]?.media).toEqual([
      { uri: 'your_facebook_activity/posts/media/x.png', creationTimestamp: 1386163100 },
    ]);
    expect(posts[0]?.links).toEqual([]);

    expect(posts[1]?.text).toBe('c mon blog !!! venez nombreux.');
    expect(posts[1]?.title).toBe('Alex Rivera a partagé un lien.');
    expect(posts[1]?.links).toEqual(['http://example.com/blog']);
    expect(posts[1]?.media).toEqual([]);
  });

  it('returns [] for non-array input; defaults empty fields for a bare post', () => {
    expect(parseFacebookPosts(null)).toEqual([]);
    expect(parseFacebookPosts({})).toEqual([]);
    expect(parseFacebookPosts([{ timestamp: 1 }])).toEqual([
      { timestamp: 1, text: '', title: '', media: [], links: [] },
    ]);
  });
});
