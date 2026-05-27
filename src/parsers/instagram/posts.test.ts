import { describe, it, expect } from 'vitest';
import { findOwnPostEntries, parseOwnPost } from './posts.js';
import type { EntryHeader } from '../shared/archive.js';

function header(fileName: string, sizeBytes = 1000): EntryHeader {
  return {
    fileName,
    uncompressedSize: sizeBytes,
    compressedSize: sizeBytes,
    lastModified: new Date(0),
  };
}

describe('findOwnPostEntries', () => {
  it('matches PNG/JPG/MP4 under your_posts/ and sorts by filename', () => {
    const entries: EntryHeader[] = [
      header('your_instagram_activity/posts/media/your_posts/zzz.png'),
      header('your_instagram_activity/posts/media/your_posts/aaa.jpg'),
      header('your_instagram_activity/posts/media/your_posts/mmm.mp4'),
      header('your_instagram_activity/posts/media/your_posts/'), // dir itself
      header('your_instagram_activity/saved/saved_posts.json'), // unrelated
      header('your_instagram_activity/posts/media/your_posts/notes.txt'), // wrong ext
    ];
    const found = findOwnPostEntries(entries);
    expect(found.map((e) => e.fileName)).toEqual([
      'your_instagram_activity/posts/media/your_posts/aaa.jpg',
      'your_instagram_activity/posts/media/your_posts/mmm.mp4',
      'your_instagram_activity/posts/media/your_posts/zzz.png',
    ]);
  });

  it('returns empty when nothing matches', () => {
    expect(findOwnPostEntries([])).toEqual([]);
    expect(findOwnPostEntries([header('docs/README.md')])).toEqual([]);
  });
});

describe('parseOwnPost', () => {
  it('extracts mediaId, ext, and size from a header', () => {
    const post = parseOwnPost(
      header('your_instagram_activity/posts/media/your_posts/9808613735843180.PNG', 52848),
    );
    expect(post).toEqual({
      uri: 'your_instagram_activity/posts/media/your_posts/9808613735843180.PNG',
      mediaId: '9808613735843180',
      ext: 'png',
      sizeBytes: 52848,
    });
  });

  it('handles files without extensions gracefully', () => {
    const post = parseOwnPost(
      header('your_instagram_activity/posts/media/your_posts/orphan', 100),
    );
    expect(post.mediaId).toBe('orphan');
    expect(post.ext).toBe('');
  });
});
