import { fixMojibake } from './encoding.js';

export interface Reaction {
  reaction: string;
  actor: string;
  timestamp: number; // seconds
}

export interface MediaRef {
  uri: string;
  creationTimestamp: number; // seconds
}

export interface SharedContent {
  link?: string;
  shareText?: string;
}

export interface Message {
  sender: string;
  timestampMs: number;
  content?: string;
  reactions: Reaction[];
  audioFiles: MediaRef[];
  photos: MediaRef[];
  videos: MediaRef[];
  gifs: MediaRef[];
  share?: SharedContent;
}

export interface Thread {
  participants: string[]; // post-mojibake names
  title: string;
  threadPath: string; // e.g. "inbox/example_thread_12345"
  isStillParticipant: boolean;
  /** Sorted chronologically (oldest first). Meta exports them newest-first; we flip. */
  messages: Message[];
}

interface RawParticipant {
  name?: string;
}
interface RawReaction {
  reaction?: string;
  actor?: string;
  timestamp?: number;
}
interface RawMediaRef {
  uri?: string;
  creation_timestamp?: number;
}
interface RawShare {
  link?: string;
  share_text?: string;
}
interface RawMessage {
  sender_name?: string;
  timestamp_ms?: number;
  content?: string;
  reactions?: RawReaction[];
  audio_files?: RawMediaRef[];
  photos?: RawMediaRef[];
  videos?: RawMediaRef[];
  gifs?: RawMediaRef[];
  share?: RawShare;
}
interface RawThread {
  participants?: RawParticipant[];
  messages?: RawMessage[];
  title?: string;
  thread_path?: string;
  is_still_participant?: boolean;
}

function parseMediaRefs(raws: RawMediaRef[] | undefined): MediaRef[] {
  if (!raws) return [];
  const out: MediaRef[] = [];
  for (const r of raws) {
    if (typeof r.uri === 'string') {
      out.push({ uri: r.uri, creationTimestamp: r.creation_timestamp ?? 0 });
    }
  }
  return out;
}

function parseReactions(raws: RawReaction[] | undefined): Reaction[] {
  if (!raws) return [];
  const out: Reaction[] = [];
  for (const r of raws) {
    if (typeof r.reaction === 'string' && typeof r.actor === 'string') {
      out.push({
        reaction: fixMojibake(r.reaction),
        actor: fixMojibake(r.actor),
        timestamp: r.timestamp ?? 0,
      });
    }
  }
  return out;
}

function parseShare(raw: RawShare | undefined): SharedContent | undefined {
  if (!raw) return undefined;
  if (!raw.link && !raw.share_text) return undefined;
  const out: SharedContent = {};
  if (raw.link) out.link = raw.link;
  if (raw.share_text) out.shareText = fixMojibake(raw.share_text);
  return out;
}

function parseMessage(raw: RawMessage): Message | null {
  if (typeof raw.sender_name !== 'string' || typeof raw.timestamp_ms !== 'number') {
    return null; // skip malformed
  }
  const msg: Message = {
    sender: fixMojibake(raw.sender_name),
    timestampMs: raw.timestamp_ms,
    reactions: parseReactions(raw.reactions),
    audioFiles: parseMediaRefs(raw.audio_files),
    photos: parseMediaRefs(raw.photos),
    videos: parseMediaRefs(raw.videos),
    gifs: parseMediaRefs(raw.gifs),
  };
  if (typeof raw.content === 'string') msg.content = fixMojibake(raw.content);
  const share = parseShare(raw.share);
  if (share) msg.share = share;
  return msg;
}

/**
 * Parse one `message_N.json` thread file into a Thread. Messages are sorted
 * oldest-first (Meta exports them newest-first). Unknown fields are silently
 * dropped — Meta's schema drifts and we want graceful degradation. Per CLAUDE.md
 * gotcha #9, View Once / Vanishing / Unsent messages are entirely absent here,
 * not flagged — there's nothing to surface for them.
 */
export function parseThread(json: unknown): Thread {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error('parseThread: expected object root');
  }
  const obj = json as RawThread;

  const participants: string[] = [];
  for (const p of obj.participants ?? []) {
    if (typeof p.name === 'string') participants.push(fixMojibake(p.name));
  }

  const messages: Message[] = [];
  for (const raw of obj.messages ?? []) {
    const m = parseMessage(raw);
    if (m) messages.push(m);
  }
  messages.sort((a, b) => a.timestampMs - b.timestampMs);

  return {
    participants,
    title: fixMojibake(obj.title ?? ''),
    threadPath: obj.thread_path ?? '',
    isStillParticipant: obj.is_still_participant ?? true,
    messages,
  };
}

/**
 * Merge multiple `message_N.json` files for one thread. Meta splits long threads
 * into multiple JSON files (message_1.json = newest batch, message_2.json = older
 * batch, etc.). Participants/title/thread_path are duplicated across files —
 * we take them from the first file and concatenate all messages.
 */
export function parseThreadFiles(jsons: unknown[]): Thread {
  if (jsons.length === 0) throw new Error('parseThreadFiles: no inputs');
  const parsed = jsons.map(parseThread);
  const base = parsed[0]!;
  const messages = parsed
    .flatMap((t) => t.messages)
    .sort((a, b) => a.timestampMs - b.timestampMs);
  return { ...base, messages };
}
