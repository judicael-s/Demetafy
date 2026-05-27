export interface PreparedArchiveSelection {
  ok: true;
  paths: string[];
  partCount: number;
  label: string;
  needsConfirmation: boolean;
}

export interface RejectedArchiveSelection {
  ok: false;
  title: string;
  body: string;
}

export type ArchiveSelectionResult = PreparedArchiveSelection | RejectedArchiveSelection;

// Multi-part Meta exports — Facebook, and large Instagram profiles too — are
// named `<service>-<user>-<date>-<random>.zip`. Every part of one export shares
// everything up to the final `-<random>` segment; capture that as the group id.
const META_PART_RE = /^((?:facebook|instagram)-.+)-[^-\\/]+\.zip$/i;

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function metaExportGroup(path: string): string | null {
  const match = META_PART_RE.exec(basename(path));
  return match?.[1] ?? null;
}

/**
 * The canonical logical-archive id for a multi-part Meta export: the
 * `service-user-date` group every part shares, with the random `-<suffix>.zip`
 * stripped. Returns null unless every path resolves to the *same* group (so an
 * unexpected mix or a non-conforming name falls back to the caller's default).
 * Used as the re-ingest idempotency key (16E/D3) so re-downloading an export —
 * which yields fresh random suffixes — still resets the same archive.
 */
export function metaExportGroupId(paths: string[]): string | null {
  const first = paths[0] === undefined ? null : metaExportGroup(paths[0]);
  if (first === null) return null;
  return paths.every((p) => metaExportGroup(p) === first) ? first : null;
}

function uniqueSorted(paths: string[]): string[] {
  return [...new Set(paths)].sort((a, b) => basename(a).localeCompare(basename(b)) || a.localeCompare(b));
}

export function prepareArchiveSelection(
  selected: string | string[] | null,
): ArchiveSelectionResult | null {
  if (selected === null) return null;
  const raw = Array.isArray(selected) ? selected : [selected];
  const paths = uniqueSorted(raw.filter((p) => p.trim().length > 0));
  if (paths.length === 0) return null;

  if (paths.length === 1) {
    return {
      ok: true,
      paths,
      partCount: 1,
      label: basename(paths[0]!),
      needsConfirmation: false,
    };
  }

  const groups = paths.map(metaExportGroup);
  if (groups.some((g) => g === null)) {
    return {
      ok: false,
      title: "Can't combine those files",
      body: "Multiple selection is for the parts of one Meta export, named like facebook-yourname-date-*.zip or instagram-yourname-date-*.zip. Pick a single zip, or every part of one export.",
    };
  }

  const first = groups[0];
  if (groups.some((g) => g !== first)) {
    return {
      ok: false,
      title: "Mixed archive parts",
      body: "Choose zip parts from a single Meta export only. These files appear to belong to different exports.",
    };
  }

  return {
    ok: true,
    paths,
    partCount: paths.length,
    label: `${first} (${paths.length} parts)`,
    needsConfirmation: true,
  };
}

export function parseDevArchivePaths(input: string): string[] {
  return input
    .split(/[\n;]/)
    .map((p) => p.trim())
    .filter(Boolean);
}
