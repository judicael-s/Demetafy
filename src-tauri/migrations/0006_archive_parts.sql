-- 0006 — multi-part archive support (Phase 2 / Facebook).
--
-- A single logical archive can span many independent zip "parts": Meta front-loads
-- media into most parts and back-loads all JSON metadata into one. We persist every
-- part's real file path so the browse-time media handler (vmedia) can resolve an
-- entry across all parts of an archive. Instagram archives are a single part, so
-- they get exactly one row here.
CREATE TABLE IF NOT EXISTS archive_parts (
    archive_id INTEGER NOT NULL,
    idx        INTEGER NOT NULL,
    path       TEXT    NOT NULL,
    PRIMARY KEY (archive_id, idx),
    FOREIGN KEY (archive_id) REFERENCES archives(id) ON DELETE CASCADE
);

-- Backfill: every pre-Phase-2 archive is one part, located at its source_path.
-- This lets the multi-part media handler rely solely on archive_parts with no
-- source_path fallback. New / re-ingested archives get their parts written by
-- ingest_into (delete-then-insert), so this one-time backfill never collides.
INSERT INTO archive_parts (archive_id, idx, path)
SELECT id, 0, source_path FROM archives;
