import { describe, it, expect, beforeEach } from 'vitest';
import {
  openDb,
  resetArchive,
  insertProfile,
  insertSaved,
  insertThread,
  insertStories,
  insertReposts,
  insertOwnPosts,
  getStats,
  search,
  transactional,
} from './db.js';
import type { DatabaseSync } from 'node:sqlite';

let db: DatabaseSync;
beforeEach(() => {
  db = openDb(':memory:');
});

describe('openDb / migrate', () => {
  it('creates all expected tables on first open', () => {
    const tables = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type IN ('table','virtual') ORDER BY name`,
      )
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'archives',
        'profile',
        'profile_changes',
        'saved_items',
        'saved_collections',
        'threads',
        'messages',
        'stories',
        'reposts',
        'own_posts',
        'saved_items_fts',
        'messages_fts',
        'reposts_fts',
      ]),
    );
  });

  it('is idempotent — re-opening does not error', () => {
    const db2 = openDb(':memory:');
    db2.close();
  });
});

describe('resetArchive', () => {
  it('creates a new archive row when source_path is new', () => {
    const id = resetArchive(db, '/path/a.zip', 'instagram');
    expect(id).toBeGreaterThan(0);
    const row = db.prepare('SELECT source_path, service FROM archives WHERE id = ?').get(id);
    expect(row).toMatchObject({ source_path: '/path/a.zip', service: 'instagram' });
  });

  it('returns the same id on re-ingest and clears dependent rows', () => {
    const id = resetArchive(db, '/path/a.zip', 'instagram');
    insertStories(db, id, [
      { uri: 'x.jpg', createdAt: new Date(1000), title: 'first' },
    ]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM stories').get()).toMatchObject({ n: 1 });

    const id2 = resetArchive(db, '/path/a.zip', 'instagram');
    expect(id2).toBe(id);
    expect(db.prepare('SELECT COUNT(*) AS n FROM stories').get()).toMatchObject({ n: 0 });
  });

  it('cascading FK deletes messages when threads are deleted', () => {
    const id = resetArchive(db, '/path/a.zip', 'instagram');
    insertThread(db, id, {
      source: 'inbox',
      slug: 'alice_1',
      thread: {
        participants: ['alice', 'bob'],
        title: 'alice',
        threadPath: 'inbox/alice_1',
        isStillParticipant: true,
        messages: [
          {
            sender: 'alice',
            timestampMs: 1000,
            content: 'hi',
            reactions: [],
            audioFiles: [],
            photos: [],
            videos: [],
            gifs: [],
          },
        ],
      },
    });
    expect(db.prepare('SELECT COUNT(*) AS n FROM messages').get()).toMatchObject({ n: 1 });

    resetArchive(db, '/path/a.zip', 'instagram');
    expect(db.prepare('SELECT COUNT(*) AS n FROM threads').get()).toMatchObject({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM messages').get()).toMatchObject({ n: 0 });
  });
});

describe('insertProfile', () => {
  it('round-trips Profile + ProfileChange', () => {
    const id = resetArchive(db, '/path/a.zip', 'instagram');
    insertProfile(
      db,
      id,
      {
        username: 'example_user',
        displayName: 'example.user',
        email: 'alex@example.com',
        isPrivateAccount: false,
        countryCode: 'FR',
        fbid: '17862665122189619',
        hasArchivedReels: true,
      },
      [
        {
          field: 'Username',
          previousValue: '',
          newValue: 'example_user',
          changedAt: new Date(1776324398000),
        },
      ],
    );
    const profile = db
      .prepare('SELECT username, country_code, is_private, has_archived_reels FROM profile')
      .get();
    expect(profile).toMatchObject({
      username: 'example_user',
      country_code: 'FR',
      is_private: 0,
      has_archived_reels: 1,
    });
    const change = db.prepare('SELECT field, new_value FROM profile_changes').get();
    expect(change).toMatchObject({ field: 'Username', new_value: 'example_user' });
  });
});

describe('insertSaved + FTS', () => {
  it('inserts items, collections, and indexes captions for full-text search', () => {
    const id = resetArchive(db, '/path/a.zip', 'instagram');
    insertSaved(
      db,
      id,
      [
        {
          url: 'https://instagram.com/reel/A/',
          caption: 'Best café in town',
          savedAt: new Date(1000),
          collections: ['Cuisine'],
        },
        {
          url: 'https://instagram.com/reel/B/',
          caption: 'no match here',
          savedAt: new Date(2000),
          collections: [],
        },
      ],
      [
        {
          name: 'Cuisine',
          type: 'Default',
          privacy: 'Private',
          createdAt: new Date(0),
          updatedAt: new Date(0),
          itemUrls: ['https://instagram.com/reel/A/'],
        },
      ],
    );

    const hits = search(db, 'café');
    expect(hits['saved_items']).toHaveLength(1);
    expect(hits['saved_items']?.[0]?.label).toBe('https://instagram.com/reel/A/');
    expect(hits['saved_items']?.[0]?.snippet).toContain('«café»');
  });
});

describe('insertThread + messages FTS', () => {
  it('indexes message content and joins back to thread for the search label', () => {
    const id = resetArchive(db, '/path/a.zip', 'instagram');
    insertThread(db, id, {
      source: 'inbox',
      slug: 'lea_123',
      thread: {
        participants: ['Robin', 'example.user'],
        title: 'Robin',
        threadPath: 'inbox/lea_123',
        isStillParticipant: true,
        messages: [
          {
            sender: 'Robin',
            timestampMs: 1000,
            content: 'On va prendre un café samedi?',
            reactions: [],
            audioFiles: [],
            photos: [],
            videos: [],
            gifs: [],
          },
          {
            sender: 'example.user',
            timestampMs: 2000,
            content: 'yes!',
            reactions: [],
            audioFiles: [],
            photos: [],
            videos: [],
            gifs: [],
          },
        ],
      },
    });

    const hits = search(db, 'café');
    expect(hits['messages']).toHaveLength(1);
    expect(hits['messages']?.[0]?.label).toBe('Robin (inbox/lea_123)');
  });
});

describe('insertReposts + reposts FTS', () => {
  it('indexes caption and user_text', () => {
    const id = resetArchive(db, '/path/a.zip', 'instagram');
    insertReposts(db, id, [
      {
        repostedAt: new Date(1000),
        expiresAt: new Date(9999),
        userText: 'great take',
        source: {
          url: 'https://x.com/p/A/',
          caption: 'the café revolution',
          title: '',
          ownerName: 'Owner',
          ownerUsername: 'owner',
        },
      },
    ]);
    const hits = search(db, 'café');
    expect(hits['reposts']).toHaveLength(1);
    expect(hits['reposts']?.[0]?.label).toBe('@owner');
  });
});

describe('getStats', () => {
  it('returns counts and archive metadata', () => {
    const id = resetArchive(db, '/path/a.zip', 'instagram');
    insertStories(db, id, [
      { uri: 'x.jpg', createdAt: new Date(1), title: 's1' },
      { uri: 'y.jpg', createdAt: new Date(2), title: 's2' },
    ]);
    insertOwnPosts(db, id, [{ uri: 'p/a.png', mediaId: 'a', ext: 'png', sizeBytes: 100 }]);
    const stats = getStats(db);
    expect(stats.archives).toHaveLength(1);
    expect(stats.archives[0]?.sourcePath).toBe('/path/a.zip');
    expect(stats.counts['stories']).toBe(2);
    expect(stats.counts['own_posts']).toBe(1);
  });
});

describe('transactional', () => {
  it('rolls back on thrown error', () => {
    const id = resetArchive(db, '/path/a.zip', 'instagram');
    expect(() =>
      transactional(db, () => {
        insertStories(db, id, [{ uri: 'a.jpg', createdAt: new Date(1), title: 't' }]);
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(db.prepare('SELECT COUNT(*) AS n FROM stories').get()).toMatchObject({ n: 0 });
  });

  it('commits on success', () => {
    const id = resetArchive(db, '/path/a.zip', 'instagram');
    transactional(db, () => {
      insertStories(db, id, [{ uri: 'a.jpg', createdAt: new Date(1), title: 't' }]);
    });
    expect(db.prepare('SELECT COUNT(*) AS n FROM stories').get()).toMatchObject({ n: 1 });
  });
});
