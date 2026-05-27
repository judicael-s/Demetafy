import { describe, it, expect, beforeEach } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDb, resetArchive, insertSaved, insertThread, insertProfile } from '../storage/db.js';
import {
  getOverview,
  getSavedItems,
  getCollections,
  getThreads,
  getThreadBySlug,
} from './queries.js';

let db: DatabaseSync;
let archiveId: number;

beforeEach(() => {
  db = openDb(':memory:');
  archiveId = resetArchive(db, '/x.zip', 'instagram');
  insertProfile(
    db,
    archiveId,
    {
      username: 'example_user',
      displayName: 'example.user',
      email: 'alex@example.com',
      countryCode: 'FR',
      isPrivateAccount: false,
    },
    [],
  );
});

describe('getOverview', () => {
  it('returns profile + counts + archives', () => {
    insertSaved(
      db,
      archiveId,
      [
        {
          url: 'https://instagram.com/reel/A/',
          caption: 'a',
          savedAt: new Date(1000),
          collections: [],
        },
      ],
      [],
    );
    const o = getOverview(db);
    expect(o.archives).toHaveLength(1);
    expect(o.profile?.username).toBe('example_user');
    expect(o.profile?.email).toBe('alex@example.com');
    expect(o.counts['saved_items']).toBe(1);
    expect(o.counts['stories']).toBe(0);
  });
});

describe('getSavedItems', () => {
  beforeEach(() => {
    insertSaved(
      db,
      archiveId,
      [
        {
          url: 'https://instagram.com/reel/A/',
          caption: 'first',
          savedAt: new Date(1000),
          collections: ['Cuisine'],
        },
        {
          url: 'https://instagram.com/reel/B/',
          caption: 'second',
          savedAt: new Date(2000),
          collections: ['Fight'],
        },
        {
          url: 'https://instagram.com/reel/C/',
          caption: 'third',
          savedAt: new Date(3000),
          collections: ['Cuisine', 'Fight'],
        },
      ],
      [],
    );
  });

  it('sorts newest-first and respects limit/offset', () => {
    const { items, total } = getSavedItems(db, { limit: 2, offset: 0 });
    expect(total).toBe(3);
    expect(items.map((i) => i.caption)).toEqual(['third', 'second']);
  });

  it('filters by collection via JSON LIKE match', () => {
    const { items, total } = getSavedItems(db, { limit: 10, offset: 0, collection: 'Cuisine' });
    expect(total).toBe(2);
    expect(items.map((i) => i.caption).sort()).toEqual(['first', 'third']);
  });

  it('paginates via offset', () => {
    const page2 = getSavedItems(db, { limit: 2, offset: 2 });
    expect(page2.items.map((i) => i.caption)).toEqual(['first']);
  });
});

describe('getCollections', () => {
  it('returns collections sorted by item count desc', () => {
    insertSaved(
      db,
      archiveId,
      [],
      [
        {
          name: 'big',
          type: 'Default',
          privacy: 'Private',
          createdAt: new Date(0),
          updatedAt: new Date(0),
          itemUrls: ['a', 'b', 'c'],
        },
        {
          name: 'small',
          type: 'Default',
          privacy: 'Private',
          createdAt: new Date(0),
          updatedAt: new Date(0),
          itemUrls: ['x'],
        },
      ],
    );
    const cols = getCollections(db);
    expect(cols.map((c) => c.name)).toEqual(['big', 'small']);
    expect(cols[0]?.itemCount).toBe(3);
  });
});

describe('getThreads / getThreadBySlug', () => {
  beforeEach(() => {
    insertThread(db, archiveId, {
      source: 'inbox',
      slug: 'alice_1',
      thread: {
        participants: ['alice', 'example.user'],
        title: 'alice',
        threadPath: 'inbox/alice_1',
        isStillParticipant: true,
        messages: [
          {
            sender: 'alice',
            timestampMs: 1000,
            content: 'first',
            reactions: [],
            audioFiles: [],
            photos: [],
            videos: [],
            gifs: [],
          },
          {
            sender: 'example.user',
            timestampMs: 5000,
            content: 'newer',
            reactions: [],
            audioFiles: [],
            photos: [],
            videos: [],
            gifs: [],
          },
        ],
      },
    });
    insertThread(db, archiveId, {
      source: 'message_requests',
      slug: 'bob_1',
      thread: {
        participants: ['bob', 'example.user'],
        title: 'bob',
        threadPath: 'message_requests/bob_1',
        isStillParticipant: true,
        messages: [
          {
            sender: 'bob',
            timestampMs: 10000,
            content: 'hey',
            reactions: [],
            audioFiles: [],
            photos: [],
            videos: [],
            gifs: [],
          },
        ],
      },
    });
  });

  it('sorts threads by last_message_at desc', () => {
    const { threads, total } = getThreads(db, { limit: 10, offset: 0 });
    expect(total).toBe(2);
    expect(threads[0]?.slug).toBe('bob_1');
    expect(threads[1]?.slug).toBe('alice_1');
  });

  it('filters by source', () => {
    const { threads } = getThreads(db, { limit: 10, offset: 0, source: 'inbox' });
    expect(threads).toHaveLength(1);
    expect(threads[0]?.slug).toBe('alice_1');
  });

  it('returns null for missing thread slug', () => {
    expect(getThreadBySlug(db, 'nope')).toBeNull();
  });

  it('returns thread with chronological messages', () => {
    const t = getThreadBySlug(db, 'alice_1');
    expect(t).not.toBeNull();
    expect(t!.messages.map((m) => m.content)).toEqual(['first', 'newer']);
    expect(t!.thread.participants).toEqual(['alice', 'example.user']);
  });
});
