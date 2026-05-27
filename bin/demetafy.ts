#!/usr/bin/env node
import path from 'node:path';
import { Command } from 'commander';
import { ArchiveReader, detectMultiPart } from '../src/parsers/shared/archive.js';
import {
  parseSavedPosts,
  parseSavedCollections,
  linkItemsToCollections,
  type SavedItem,
} from '../src/parsers/instagram/saved.js';
import { parseThreadFiles, type Thread, type Message } from '../src/parsers/instagram/messages.js';
import { parseStories } from '../src/parsers/instagram/stories.js';
import { parseReposts } from '../src/parsers/instagram/reposts.js';
import { findOwnPostEntries, parseOwnPost } from '../src/parsers/instagram/posts.js';
import { parseProfile, parseProfileChanges } from '../src/parsers/instagram/profile.js';
import {
  checkYtdlpAvailable,
  runYtdlpWithRetry,
  extractInstagramId,
  type DownloadResult,
} from '../src/downloaders/ytdlp.js';
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
} from '../src/storage/db.js';
import { startServer } from '../src/viewer/server.js';

const program = new Command();
program
  .name('demetafy')
  .description('Privacy-first archive viewer for Meta DYI exports (Phase 0 CLI)')
  .version('0.0.0');

// ─────────────────────────────────────────────────────────────────────────────
// saved
// ─────────────────────────────────────────────────────────────────────────────

const saved = program.command('saved').description('Saved posts and collections');

saved
  .command('list')
  .description('List saved items from an Instagram archive')
  .argument('<archive>', 'Path to Instagram DYI .zip')
  .option('-n, --limit <n>', 'Show top N most-recent items', '10')
  .action(async (archivePath: string, opts: { limit: string }) => {
    const limit = parsePositiveInt(opts.limit, '--limit');
    warnIfMultiPart(archivePath);

    const reader = await ArchiveReader.open(archivePath);
    try {
      const SAVED_POSTS = 'your_instagram_activity/saved/saved_posts.json';
      const SAVED_COLLECTIONS = 'your_instagram_activity/saved/saved_collections.json';
      requireEntry(reader, SAVED_POSTS);
      requireEntry(reader, SAVED_COLLECTIONS);

      const savedJson = JSON.parse(await reader.readEntryText(SAVED_POSTS));
      const collectionsJson = JSON.parse(await reader.readEntryText(SAVED_COLLECTIONS));
      const collections = parseSavedCollections(collectionsJson);
      const items = linkItemsToCollections(parseSavedPosts(savedJson), collections);

      console.log('');
      console.log(`Archive:           ${archivePath}`);
      console.log(`Total saved items: ${items.length}`);
      console.log(`Collections:       ${collections.length}`);
      console.log('');

      const sorted = [...items].sort((a, b) => b.savedAt.getTime() - a.savedAt.getTime());
      console.log(`Top ${Math.min(limit, sorted.length)} most-recent saved:`);
      console.log('');
      for (const item of sorted.slice(0, limit)) {
        const date = item.savedAt.toISOString().slice(0, 10);
        const colTag = item.collections.length > 0 ? `  [${item.collections.join(', ')}]` : '';
        const caption = item.caption.slice(0, 80).replace(/\s+/g, ' ');
        const ellipsis = item.caption.length > 80 ? '…' : '';
        console.log(`  ${date}  ${item.url}${colTag}`);
        if (caption) console.log(`              ${caption}${ellipsis}`);
      }

      console.log('');
      console.log('Collections summary:');
      for (const c of [...collections].sort((a, b) => b.itemUrls.length - a.itemUrls.length)) {
        console.log(
          `  ${c.name.padEnd(30)}  ${c.itemUrls.length.toString().padStart(4)} items  (${c.privacy})`,
        );
      }
      console.log('');
    } finally {
      reader.close();
    }
  });

saved
  .command('download')
  .description('Download videos from saved permalinks via yt-dlp (must be installed on PATH)')
  .argument('<archive>', 'Path to Instagram DYI .zip')
  .option(
    '-c, --collection <name>',
    'Only items in this collection (case-insensitive substring match)',
  )
  .option('-n, --limit <n>', 'Cap number of items (0 = no cap)', '0')
  .option('-o, --out <dir>', 'Output base directory', 'data/extracted/instagram/saved')
  .option('-p, --parallel <n>', 'Concurrent downloads', '3')
  .option('--cookies <file>', 'Netscape-format cookies file for login-walled content')
  .action(
    async (
      archivePath: string,
      opts: {
        collection?: string;
        limit: string;
        out: string;
        parallel: string;
        cookies?: string;
      },
    ) => {
      const version = await checkYtdlpAvailable();
      if (!version) {
        throw new Error(
          'yt-dlp not found on PATH. Install: `scoop install yt-dlp` (Windows) ' +
            'or see https://github.com/yt-dlp/yt-dlp.',
        );
      }

      const parallel = parsePositiveInt(opts.parallel, '--parallel');
      const limit = parseInt(opts.limit, 10);
      if (!Number.isFinite(limit) || limit < 0) {
        throw new Error(`--limit must be a non-negative integer, got: ${opts.limit}`);
      }
      warnIfMultiPart(archivePath);

      const reader = await ArchiveReader.open(archivePath);
      try {
        const SAVED_POSTS = 'your_instagram_activity/saved/saved_posts.json';
        const SAVED_COLLECTIONS = 'your_instagram_activity/saved/saved_collections.json';
        requireEntry(reader, SAVED_POSTS);
        requireEntry(reader, SAVED_COLLECTIONS);

        const collections = parseSavedCollections(
          JSON.parse(await reader.readEntryText(SAVED_COLLECTIONS)),
        );
        const allItems = linkItemsToCollections(
          parseSavedPosts(JSON.parse(await reader.readEntryText(SAVED_POSTS))),
          collections,
        );

        let queue: SavedItem[] = allItems;
        if (opts.collection) {
          const needle = opts.collection.toLowerCase();
          queue = queue.filter((i) =>
            i.collections.some((c) => c.toLowerCase().includes(needle)),
          );
        }
        queue = [...queue].sort((a, b) => b.savedAt.getTime() - a.savedAt.getTime());
        if (limit > 0) queue = queue.slice(0, limit);

        if (queue.length === 0) {
          console.log('No saved items match the filters.');
          return;
        }

        console.log('');
        console.log(`Using yt-dlp ${version}`);
        console.log(`Queued ${queue.length} item(s) · parallel: ${parallel}`);
        if (opts.cookies) console.log(`Cookies: ${opts.cookies}`);
        console.log('');

        const counters: Record<DownloadResult['kind'], number> = {
          ok: 0,
          skipped: 0,
          dead: 0,
          loginWalled: 0,
          transient: 0,
          unknown: 0,
        };
        let done = 0;

        await runQueue(queue, parallel, async (item) => {
          const collection = item.collections[0] ?? '_uncategorized';
          const outputDir = path.join(opts.out, slugify(collection));
          const retryOpts = opts.cookies ? { cookiesPath: opts.cookies } : {};
          const result = await runYtdlpWithRetry(item.url, outputDir, retryOpts);
          counters[result.kind]++;

          done++;
          const id = extractInstagramId(item.url) ?? item.url.slice(-15);
          const tag = `[${done.toString().padStart(queue.length.toString().length)}/${queue.length}]`;
          const sym = resultSymbol(result.kind);
          const detail = formatResultDetail(result);
          console.log(`${tag}  ${sym}  ${id.padEnd(15)}  [${collection.slice(0, 18).padEnd(18)}]  ${detail}`);
        });

        console.log('');
        console.log(
          `Done. ${counters.ok} downloaded · ${counters.skipped} skipped · ` +
            `${counters.loginWalled} login-walled · ${counters.dead} dead · ` +
            `${counters.transient} retried-out · ${counters.unknown} unknown`,
        );
        console.log('');
      } finally {
        reader.close();
      }
    },
  );

// ─────────────────────────────────────────────────────────────────────────────
// messages
// ─────────────────────────────────────────────────────────────────────────────

type MessagesSource = 'inbox' | 'message_requests' | 'broadcast';
interface ThreadFiles {
  source: MessagesSource;
  folder: string; // full path to folder inside zip
  slug: string; // last segment of folder
  files: string[]; // sorted message_N.json paths
}

function discoverThreads(reader: ArchiveReader, sources: MessagesSource[]): ThreadFiles[] {
  const byFolder = new Map<string, ThreadFiles>();
  const messageFileRe = /\/message_\d+\.json$/;
  for (const entry of reader.listEntries()) {
    for (const source of sources) {
      const prefix = `your_instagram_activity/messages/${source}/`;
      if (entry.fileName.startsWith(prefix) && messageFileRe.test(entry.fileName)) {
        const folder = entry.fileName.slice(0, entry.fileName.lastIndexOf('/'));
        const slug = folder.slice(folder.lastIndexOf('/') + 1);
        const existing = byFolder.get(folder);
        if (existing) {
          existing.files.push(entry.fileName);
        } else {
          byFolder.set(folder, { source, folder, slug, files: [entry.fileName] });
        }
        break;
      }
    }
  }
  for (const tf of byFolder.values()) tf.files.sort();
  return [...byFolder.values()];
}

async function loadThread(reader: ArchiveReader, tf: ThreadFiles): Promise<Thread> {
  const jsons = await Promise.all(
    tf.files.map(async (path) => JSON.parse(await reader.readEntryText(path))),
  );
  return parseThreadFiles(jsons);
}

function formatTimestamp(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

function messagePreview(msg: Message): string {
  if (msg.content) return msg.content;
  if (msg.photos.length > 0) return '[photo]';
  if (msg.videos.length > 0) return '[video]';
  if (msg.audioFiles.length > 0) return '[audio]';
  if (msg.gifs.length > 0) return '[gif]';
  if (msg.share) return msg.share.link ? `[share: ${msg.share.link}]` : '[share]';
  return '[empty]';
}

const messages = program.command('messages').description('Direct messages and conversations');

messages
  .command('list')
  .description('List DM threads sorted by most recent activity')
  .argument('<archive>', 'Path to Instagram DYI .zip')
  .option('--include-requests', 'Include message_requests threads')
  .option('--include-broadcast', 'Include broadcast channels')
  .option('-n, --limit <n>', 'Limit number of threads shown', '20')
  .action(
    async (
      archivePath: string,
      opts: { limit: string; includeRequests?: boolean; includeBroadcast?: boolean },
    ) => {
      const limit = parsePositiveInt(opts.limit, '--limit');
      warnIfMultiPart(archivePath);

      const sources: MessagesSource[] = ['inbox'];
      if (opts.includeRequests) sources.push('message_requests');
      if (opts.includeBroadcast) sources.push('broadcast');

      const reader = await ArchiveReader.open(archivePath);
      try {
        const tfs = discoverThreads(reader, sources);
        if (tfs.length === 0) {
          console.log('No DM threads found in archive.');
          return;
        }

        // Resolve the archive owner's display name to hide "self" from the
        // participant column (shows everyone if the profile can't be read).
        const PERSONAL = 'personal_information/personal_information/personal_information.json';
        const IG_PROFILE =
          'personal_information/personal_information/instagram_profile_information.json';
        const selfName = parseProfile(
          reader.hasEntry(PERSONAL) ? JSON.parse(await reader.readEntryText(PERSONAL)) : null,
          reader.hasEntry(IG_PROFILE) ? JSON.parse(await reader.readEntryText(IG_PROFILE)) : null,
        ).displayName;

        // Full-parse every thread to get participants + last-message timestamp.
        // 217 threads × ~200KB = ~40MB read; finishes in seconds. Sufficient for Phase 0.
        const loaded = await Promise.all(
          tfs.map(async (tf) => ({ tf, thread: await loadThread(reader, tf) })),
        );

        loaded.sort((a, b) => {
          const aLast = a.thread.messages[a.thread.messages.length - 1]?.timestampMs ?? 0;
          const bLast = b.thread.messages[b.thread.messages.length - 1]?.timestampMs ?? 0;
          return bLast - aLast;
        });

        const counts = {
          inbox: tfs.filter((t) => t.source === 'inbox').length,
          message_requests: tfs.filter((t) => t.source === 'message_requests').length,
          broadcast: tfs.filter((t) => t.source === 'broadcast').length,
        };

        console.log('');
        console.log(
          `DM threads:  ${counts.inbox} inbox` +
            (opts.includeRequests ? ` · ${counts.message_requests} requests` : '') +
            (opts.includeBroadcast ? ` · ${counts.broadcast} broadcast` : ''),
        );
        console.log('');
        console.log(`Top ${Math.min(limit, loaded.length)} threads by most-recent activity:`);
        console.log('');

        for (const { tf, thread } of loaded.slice(0, limit)) {
          const last = thread.messages[thread.messages.length - 1];
          const date = last ? formatTimestamp(last.timestampMs).slice(0, 10) : '----------';
          const tag = tf.source === 'inbox' ? '' : `  [${tf.source}]`;
          const others = thread.participants.filter((p) => p !== selfName);
          const who = (others.length > 0 ? others : thread.participants).join(', ').slice(0, 40);
          const count = `${thread.messages.length} msg`;
          const preview = last ? messagePreview(last).slice(0, 50).replace(/\s+/g, ' ') : '';
          console.log(`  ${date}  ${who.padEnd(42)}  ${count.padStart(7)}   ${preview}${tag}`);
        }

        console.log('');
        const hidden: string[] = [];
        if (!opts.includeRequests) hidden.push('--include-requests for message_requests');
        if (!opts.includeBroadcast) hidden.push('--include-broadcast for broadcast');
        if (hidden.length > 0) console.log(`Hidden: pass ${hidden.join(' / ')}`);
        console.log(`Read a thread: demetafy messages show <archive> <slug>`);
        console.log('');
      } finally {
        reader.close();
      }
    },
  );

messages
  .command('show')
  .description('Print messages from one thread (substring match on slug)')
  .argument('<archive>', 'Path to Instagram DYI .zip')
  .argument('<slug>', 'Thread slug or substring of it')
  .option('--include-requests', 'Also search message_requests')
  .option('--include-broadcast', 'Also search broadcast')
  .action(
    async (
      archivePath: string,
      slug: string,
      opts: { includeRequests?: boolean; includeBroadcast?: boolean },
    ) => {
      warnIfMultiPart(archivePath);

      const sources: MessagesSource[] = ['inbox'];
      if (opts.includeRequests) sources.push('message_requests');
      if (opts.includeBroadcast) sources.push('broadcast');

      const reader = await ArchiveReader.open(archivePath);
      try {
        const tfs = discoverThreads(reader, sources);
        const needle = slug.toLowerCase();
        const matches = tfs.filter((t) => t.slug.toLowerCase().includes(needle));

        if (matches.length === 0) {
          console.error(`No thread matches "${slug}".`);
          console.error(`Try: demetafy messages list ${archivePath}`);
          process.exit(2);
        }
        if (matches.length > 1) {
          console.error(`"${slug}" is ambiguous — ${matches.length} matches:`);
          for (const m of matches.slice(0, 20)) {
            console.error(`  ${m.slug}  [${m.source}]`);
          }
          if (matches.length > 20) console.error(`  ... and ${matches.length - 20} more`);
          console.error('Use a more specific slug.');
          process.exit(2);
        }

        const tf = matches[0]!;
        const thread = await loadThread(reader, tf);
        renderThread(tf, thread);
      } finally {
        reader.close();
      }
    },
  );

function renderThread(tf: ThreadFiles, thread: Thread): void {
  console.log('');
  console.log(`Thread:        ${tf.source}/${tf.slug}`);
  if (thread.title) console.log(`Title:         ${thread.title}`);
  console.log(`Participants:  ${thread.participants.join(', ')}`);
  console.log(`Messages:      ${thread.messages.length}`);
  console.log(`Files:         ${tf.files.length} message file(s)`);
  console.log('');

  for (const m of thread.messages) {
    console.log(`${formatTimestamp(m.timestampMs)}  ${m.sender}`);
    if (m.content) {
      for (const line of m.content.split('\n')) console.log(`   ${line}`);
    }
    for (const a of m.audioFiles) console.log(`   [audio: ${a.uri}]`);
    for (const p of m.photos) console.log(`   [photo: ${p.uri}]`);
    for (const v of m.videos) console.log(`   [video: ${v.uri}]`);
    for (const g of m.gifs) console.log(`   [gif: ${g.uri}]`);
    if (m.share) {
      const parts: string[] = [];
      if (m.share.link) parts.push(m.share.link);
      if (m.share.shareText) parts.push(`"${m.share.shareText}"`);
      console.log(`   [share: ${parts.join(' ')}]`);
    }
    for (const r of m.reactions) {
      console.log(`   ${r.reaction} ${r.actor}`);
    }
    console.log('');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// stories
// ─────────────────────────────────────────────────────────────────────────────

program
  .command('stories')
  .description('List archived stories with creation dates and titles')
  .argument('<archive>', 'Path to Instagram DYI .zip')
  .option('-n, --limit <n>', 'Show top N most-recent stories', '15')
  .action(async (archivePath: string, opts: { limit: string }) => {
    const limit = parsePositiveInt(opts.limit, '--limit');
    warnIfMultiPart(archivePath);
    const reader = await ArchiveReader.open(archivePath);
    try {
      const STORIES = 'your_instagram_activity/media/stories.json';
      requireEntry(reader, STORIES);
      const stories = parseStories(JSON.parse(await reader.readEntryText(STORIES)));
      console.log('');
      console.log(`Total stories: ${stories.length}`);
      if (stories.length > 0) {
        const firstDate = stories[stories.length - 1]?.createdAt.toISOString().slice(0, 10);
        const lastDate = stories[0]?.createdAt.toISOString().slice(0, 10);
        console.log(`Date range:    ${firstDate}  →  ${lastDate}`);
      }
      console.log('');
      console.log(`Top ${Math.min(limit, stories.length)} most-recent:`);
      console.log('');
      for (const s of stories.slice(0, limit)) {
        const date = s.createdAt.toISOString().slice(0, 10);
        const src = s.sourceApp ? `  [${s.sourceApp}]` : '';
        const title = s.title ? `  "${s.title}"` : '';
        console.log(`  ${date}  ${s.uri}${title}${src}`);
      }
      console.log('');
    } finally {
      reader.close();
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// reposts
// ─────────────────────────────────────────────────────────────────────────────

program
  .command('reposts')
  .description('List reposts (Instagram-feed re-shares)')
  .argument('<archive>', 'Path to Instagram DYI .zip')
  .option('-n, --limit <n>', 'Show top N most-recent reposts', '10')
  .action(async (archivePath: string, opts: { limit: string }) => {
    const limit = parsePositiveInt(opts.limit, '--limit');
    warnIfMultiPart(archivePath);
    const reader = await ArchiveReader.open(archivePath);
    try {
      const REPOSTS = 'your_instagram_activity/media/reposts.json';
      requireEntry(reader, REPOSTS);
      const reposts = parseReposts(JSON.parse(await reader.readEntryText(REPOSTS)));
      console.log('');
      console.log(`Total reposts: ${reposts.length}`);
      console.log('');
      console.log(`Top ${Math.min(limit, reposts.length)} most-recent:`);
      console.log('');
      for (const r of reposts.slice(0, limit)) {
        const date = r.repostedAt.toISOString().slice(0, 10);
        const owner = r.source.ownerUsername
          ? `@${r.source.ownerUsername}`
          : r.source.ownerName || '?';
        const caption = r.source.caption.slice(0, 80).replace(/\s+/g, ' ');
        const ellipsis = r.source.caption.length > 80 ? '…' : '';
        console.log(`  ${date}  ${r.source.url}  by ${owner}`);
        if (r.userText) console.log(`              note: "${r.userText.slice(0, 80)}"`);
        if (caption) console.log(`              ${caption}${ellipsis}`);
      }
      console.log('');
    } finally {
      reader.close();
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// posts (own feed posts)
// ─────────────────────────────────────────────────────────────────────────────

program
  .command('posts')
  .description('List own feed posts (Meta DYI 2026 ships only media — no JSON metadata)')
  .argument('<archive>', 'Path to Instagram DYI .zip')
  .action(async (archivePath: string) => {
    warnIfMultiPart(archivePath);
    const reader = await ArchiveReader.open(archivePath);
    try {
      const entries = reader.listEntries();
      const ownEntries = findOwnPostEntries(entries);
      const posts = ownEntries.map(parseOwnPost);
      console.log('');
      console.log(`Total own-post media files: ${posts.length}`);
      if (posts.length === 0) {
        console.log('(Archive contains no own-post media.)');
        return;
      }
      console.log('');
      console.log(
        'NOTE: Meta DYI 2026-05 omits the posts JSON index. Only raw media is available —',
      );
      console.log(
        'captions, timestamps, locations, and tags are not recoverable from this archive.',
      );
      console.log('');
      const totalBytes = posts.reduce((sum, p) => sum + p.sizeBytes, 0);
      console.log(`Total size: ${(totalBytes / 1024).toFixed(1)} KB`);
      console.log('');
      for (const p of posts) {
        const kb = (p.sizeBytes / 1024).toFixed(1).padStart(8);
        console.log(`  ${p.mediaId.padEnd(20)}  ${p.ext.padEnd(4)}  ${kb} KB  ${p.uri}`);
      }
      console.log('');
    } finally {
      reader.close();
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// profile
// ─────────────────────────────────────────────────────────────────────────────

program
  .command('profile')
  .description('Show profile information and rename history')
  .argument('<archive>', 'Path to Instagram DYI .zip')
  .action(async (archivePath: string) => {
    warnIfMultiPart(archivePath);
    const reader = await ArchiveReader.open(archivePath);
    try {
      const PERSONAL = 'personal_information/personal_information/personal_information.json';
      const IG_PROFILE =
        'personal_information/personal_information/instagram_profile_information.json';
      const CHANGES = 'personal_information/personal_information/profile_changes.json';

      const personal = reader.hasEntry(PERSONAL)
        ? JSON.parse(await reader.readEntryText(PERSONAL))
        : null;
      const igProfile = reader.hasEntry(IG_PROFILE)
        ? JSON.parse(await reader.readEntryText(IG_PROFILE))
        : null;
      const profile = parseProfile(personal, igProfile);
      const changes = reader.hasEntry(CHANGES)
        ? parseProfileChanges(JSON.parse(await reader.readEntryText(CHANGES)))
        : [];

      console.log('');
      console.log(`Username:           ${profile.username}`);
      console.log(`Name:               ${profile.displayName}`);
      if (profile.email) console.log(`Email:              ${profile.email}`);
      if (profile.phone) console.log(`Phone:              ${profile.phone}`);
      if (profile.gender) console.log(`Gender:             ${profile.gender}`);
      if (profile.dateOfBirth) console.log(`Date of birth:      ${profile.dateOfBirth}`);
      console.log(`Private account:    ${profile.isPrivateAccount}`);
      if (profile.countryCode) console.log(`Country code:       ${profile.countryCode}`);
      if (profile.fbid) console.log(`Internal FBID:      ${profile.fbid}`);
      if (profile.hasArchivedReels !== undefined) {
        console.log(`Has archived reels: ${profile.hasArchivedReels}`);
      }
      if (profile.firstStoryAt) {
        console.log(`First story:        ${profile.firstStoryAt.toISOString().slice(0, 10)}`);
      }
      if (profile.lastStoryAt) {
        console.log(`Last story:         ${profile.lastStoryAt.toISOString().slice(0, 10)}`);
      }
      if (profile.lastLoginAt) {
        const t = profile.lastLoginAt.toISOString().slice(0, 19).replace('T', ' ');
        console.log(`Last login:         ${t}`);
      }
      if (profile.profilePhotoUri) {
        console.log(`Profile photo:      ${profile.profilePhotoUri}`);
      }

      if (changes.length > 0) {
        console.log('');
        console.log(`Profile changes (${changes.length}):`);
        for (const c of changes) {
          const date = c.changedAt.toISOString().slice(0, 10);
          const prev = c.previousValue || '<empty>';
          console.log(`  ${date}  ${c.field}:  ${prev}  →  ${c.newValue}`);
        }
      }
      console.log('');
    } finally {
      reader.close();
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// ingest / stats / search (SQLite index)
// ─────────────────────────────────────────────────────────────────────────────

program
  .command('ingest')
  .description('Parse an Instagram archive and write all rows into the SQLite index')
  .argument('<archive>', 'Path to Instagram DYI .zip')
  .option('-d, --db <path>', 'SQLite index path (created if missing)', 'data/index.sqlite')
  .action(async (archivePath: string, opts: { db: string }) => {
    warnIfMultiPart(archivePath);
    const startedAt = Date.now();
    console.log('');
    console.log(`Ingesting: ${archivePath}`);
    console.log(`Index:     ${opts.db}`);

    const reader = await ArchiveReader.open(archivePath);
    const db = openDb(opts.db);
    try {
      // ── async: read & parse everything from the archive ──
      const PERSONAL = 'personal_information/personal_information/personal_information.json';
      const IG_PROFILE =
        'personal_information/personal_information/instagram_profile_information.json';
      const CHANGES = 'personal_information/personal_information/profile_changes.json';
      const SAVED_POSTS = 'your_instagram_activity/saved/saved_posts.json';
      const SAVED_COLLECTIONS = 'your_instagram_activity/saved/saved_collections.json';
      const STORIES = 'your_instagram_activity/media/stories.json';
      const REPOSTS = 'your_instagram_activity/media/reposts.json';

      const personal = reader.hasEntry(PERSONAL)
        ? JSON.parse(await reader.readEntryText(PERSONAL))
        : null;
      const igProfile = reader.hasEntry(IG_PROFILE)
        ? JSON.parse(await reader.readEntryText(IG_PROFILE))
        : null;
      const profile = parseProfile(personal, igProfile);
      const profileChanges = reader.hasEntry(CHANGES)
        ? parseProfileChanges(JSON.parse(await reader.readEntryText(CHANGES)))
        : [];

      const savedItems = reader.hasEntry(SAVED_POSTS)
        ? linkItemsToCollections(
            parseSavedPosts(JSON.parse(await reader.readEntryText(SAVED_POSTS))),
            reader.hasEntry(SAVED_COLLECTIONS)
              ? parseSavedCollections(JSON.parse(await reader.readEntryText(SAVED_COLLECTIONS)))
              : [],
          )
        : [];
      const savedCollections = reader.hasEntry(SAVED_COLLECTIONS)
        ? parseSavedCollections(JSON.parse(await reader.readEntryText(SAVED_COLLECTIONS)))
        : [];

      const stories = reader.hasEntry(STORIES)
        ? parseStories(JSON.parse(await reader.readEntryText(STORIES)))
        : [];
      const reposts = reader.hasEntry(REPOSTS)
        ? parseReposts(JSON.parse(await reader.readEntryText(REPOSTS)))
        : [];

      const ownPosts = findOwnPostEntries(reader.listEntries()).map(parseOwnPost);

      const tfs = discoverThreads(reader, ['inbox', 'message_requests', 'broadcast']);
      console.log(`Reading ${tfs.length} thread(s) in parallel...`);
      const loaded = await Promise.all(
        tfs.map(async (tf) => ({ tf, thread: await loadThread(reader, tf) })),
      );

      // ── sync: write everything in one transaction ──
      console.log('Writing to SQLite (transactional)...');
      transactional(db, () => {
        const archiveId = resetArchive(db, archivePath, 'instagram');
        insertProfile(db, archiveId, profile, profileChanges);
        insertSaved(db, archiveId, savedItems, savedCollections);
        insertStories(db, archiveId, stories);
        insertReposts(db, archiveId, reposts);
        insertOwnPosts(db, archiveId, ownPosts);
        for (const { tf, thread } of loaded) {
          insertThread(db, archiveId, { source: tf.source, slug: tf.slug, thread });
        }
      });

      const stats = getStats(db);
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      console.log('');
      console.log(`Done in ${elapsed}s. Rows in index:`);
      for (const [t, n] of Object.entries(stats.counts)) {
        console.log(`  ${t.padEnd(20)}  ${n.toString().padStart(6)}`);
      }
      console.log('');
    } finally {
      reader.close();
      db.close();
    }
  });

program
  .command('stats')
  .description('Show counts and archives in the SQLite index')
  .option('-d, --db <path>', 'SQLite index path', 'data/index.sqlite')
  .action((opts: { db: string }) => {
    const db = openDb(opts.db);
    try {
      const stats = getStats(db);
      console.log('');
      console.log(`Archives (${stats.archives.length}):`);
      for (const a of stats.archives) {
        const ts = a.ingestedAt.toISOString().slice(0, 19).replace('T', ' ');
        console.log(`  [${a.id}]  ${a.service.padEnd(10)}  ${ts}  ${a.sourcePath}`);
      }
      console.log('');
      console.log('Row counts:');
      for (const [t, n] of Object.entries(stats.counts)) {
        console.log(`  ${t.padEnd(20)}  ${n.toString().padStart(6)}`);
      }
      console.log('');
    } finally {
      db.close();
    }
  });

program
  .command('serve')
  .description('Run the local web viewer (Phase 0 sanity check) — http://localhost:<port>')
  .option('-d, --db <path>', 'SQLite index path', 'data/index.sqlite')
  .option('-p, --port <n>', 'Port to listen on', '5173')
  .option(
    '-m, --media <dir>',
    'Downloaded media root (served at /media/saved/...)',
    'data/extracted/instagram/saved',
  )
  .action((opts: { db: string; port: string; media: string }) => {
    const port = parsePositiveInt(opts.port, '--port');
    startServer({ dbPath: opts.db, port, mediaRoot: opts.media });
  });

program
  .command('search')
  .description('Full-text search (FTS5) across saved captions, message content, and reposts')
  .argument('<query>', 'Search query (FTS5 syntax — bare words for simple terms)')
  .option('-d, --db <path>', 'SQLite index path', 'data/index.sqlite')
  .option('-n, --limit <n>', 'Max hits per category', '10')
  .action((query: string, opts: { db: string; limit: string }) => {
    const limit = parsePositiveInt(opts.limit, '--limit');
    const db = openDb(opts.db);
    try {
      const results = search(db, query, limit);
      let totalHits = 0;
      console.log('');
      console.log(`Search: "${query}"`);
      for (const [table, hits] of Object.entries(results)) {
        console.log('');
        console.log(`${table} (${hits.length} hit${hits.length === 1 ? '' : 's'}):`);
        if (hits.length === 0) {
          console.log('  -');
          continue;
        }
        for (const hit of hits) {
          totalHits++;
          const date = new Date(hit.timestamp).toISOString().slice(0, 10);
          console.log(`  ${date}  ${hit.label}`);
          console.log(`              ${hit.snippet}`);
        }
      }
      console.log('');
      console.log(`Total: ${totalHits} hit${totalHits === 1 ? '' : 's'}`);
      console.log('');
    } finally {
      db.close();
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────────

function parsePositiveInt(raw: string, flagName: string): number {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error(`${flagName} must be a positive integer, got: ${raw}`);
  }
  return n;
}

function requireEntry(reader: ArchiveReader, path: string): void {
  if (!reader.hasEntry(path)) {
    throw new Error(`Archive missing required entry: ${path}`);
  }
}

function warnIfMultiPart(archivePath: string): void {
  const mp = detectMultiPart(archivePath);
  if (mp.isMultiPart) {
    console.warn(
      `WARN: ${archivePath} looks like part of a multi-part archive ` +
        `(pattern: ${mp.siblingPattern}). Multi-part assembly is not yet implemented; ` +
        `results may be incomplete.`,
    );
  }
}

function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return s || 'untitled';
}

function resultSymbol(kind: DownloadResult['kind']): string {
  switch (kind) {
    case 'ok':
      return '✓';
    case 'skipped':
      return '→';
    case 'dead':
      return '✗';
    case 'loginWalled':
      return '⊘';
    case 'transient':
      return '⏱';
    case 'unknown':
      return '?';
  }
}

function formatResultDetail(result: DownloadResult): string {
  switch (result.kind) {
    case 'ok':
      return `→ ${result.outputPath}  (${(result.durationMs / 1000).toFixed(1)}s)`;
    case 'skipped':
      return `← already at ${result.outputPath}`;
    case 'dead':
    case 'loginWalled':
    case 'transient':
      return `← ${result.reason}`;
    case 'unknown':
      return `← exit ${result.exitCode}: ${result.reason}`;
  }
}

/** Bounded-concurrency queue: at most `parallel` workers consume `items` in parallel. */
async function runQueue<T>(
  items: T[],
  parallel: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const take = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      await worker(items[i]!);
    }
  };
  const workers = Math.min(parallel, items.length);
  await Promise.all(Array.from({ length: workers }, () => take()));
}

program.parseAsync(process.argv).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`demetafy: ${msg}`);
  process.exit(1);
});
