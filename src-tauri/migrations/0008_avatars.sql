-- Opt-in Instagram friend-avatar cache (the one network feature; OFF by default).
-- Keyed by (service, handle). Only rows with status='ok' carry a local_path; the
-- other statuses record why a fetch didn't yield an image so the worker can skip
-- or retry. No FK to archives: a handle can recur across archives, and avatars are
-- a cross-cutting cache, not archive content. FB is unsupported (no handle), so in
-- practice service='instagram'.
CREATE TABLE IF NOT EXISTS avatars (
  service     TEXT    NOT NULL,
  handle      TEXT    NOT NULL,
  local_path  TEXT,                 -- relative path under the downloads root; NULL unless status='ok'
  status      TEXT    NOT NULL,     -- 'ok' | 'unavailable' | 'login_walled' | 'error'
  fetched_at  INTEGER NOT NULL,     -- ms since epoch
  PRIMARY KEY (service, handle)
);
