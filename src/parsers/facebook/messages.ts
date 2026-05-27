// Facebook Messenger JSON is structurally identical to Instagram's DM export
// (verified 2026-05-24 against Alex' archive: same participants[].name,
// messages[].{sender_name,timestamp_ms,content,reactions,photos/videos/audio_files/gifs,share}
// keys, same Latin-1-over-UTF-8 mojibake). So the Instagram thread parser is
// reused verbatim — this module only adds the Facebook-specific thread
// categories and re-exports the shared types.
export {
  parseThread,
  parseThreadFiles,
  type Thread,
  type Message,
  type Reaction,
  type MediaRef,
  type SharedContent,
} from '../instagram/messages.js';

/**
 * Thread categories under `your_facebook_activity/messages/`. Mirrors
 * Instagram's `inbox`/`message_requests` but adds `archived_threads`,
 * `filtered_threads`, and `e2ee_cutover` — the last is CLAUDE.md gotcha #10's
 * divergence: Facebook folds E2EE-cutover threads inline as ordinary readable
 * plaintext (no separate PIN-gated export like Instagram).
 */
export const FACEBOOK_THREAD_CATEGORIES = [
  'inbox',
  'archived_threads',
  'filtered_threads',
  'message_requests',
  'e2ee_cutover',
] as const;

export type FacebookThreadCategory = (typeof FACEBOOK_THREAD_CATEGORIES)[number];
