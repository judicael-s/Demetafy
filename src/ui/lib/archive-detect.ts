/**
 * Which Meta service a DYI archive belongs to, decided by its internal layout
 * (CLAUDE.md gotcha #11: parser-pack selection is driven by the archive root,
 * never by user input — Meta exports one Accounts Center profile at a time).
 */
export type ArchiveType = "instagram" | "facebook" | "unknown";

const IG_PREFIX = "your_instagram_activity/";
const IG_PROFILE_FILE = "instagram_profile_information.json";
const FB_PREFIX = "your_facebook_activity/";
const FB_PROFILE_FILE = "facebook_profile_information.json";

/**
 * Classify an archive from its entry names. Instagram is the only supported
 * service in Phase 1, so its signature wins whenever present. Facebook is
 * detected best-effort to give a precise "Phase 2" message; anything we can't
 * place — corrupt, partial, or simply not a DYI export — is `unknown`.
 *
 * Pure (no I/O) so it's unit-testable without the Tauri runtime; the caller
 * passes the entry list `TauriArchiveReader.open` already fetched.
 */
export function detectArchiveType(entryNames: Iterable<string>): ArchiveType {
  let facebook = false;
  for (const name of entryNames) {
    if (name.startsWith(IG_PREFIX) || name.endsWith(IG_PROFILE_FILE)) {
      return "instagram";
    }
    if (name.startsWith(FB_PREFIX) || name.endsWith(FB_PROFILE_FILE)) {
      facebook = true;
    }
  }
  return facebook ? "facebook" : "unknown";
}
