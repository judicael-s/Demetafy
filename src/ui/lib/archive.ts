import { invoke } from "@tauri-apps/api/core";

export interface EntryHeader {
  fileName: string;
  uncompressedSize: number;
  compressedSize: number;
}

/**
 * The archive surface the parsers consume. Satisfied by both the single-zip
 * {@link TauriArchiveReader} and the multi-part {@link MergedArchiveReader}, so
 * ingest code can stay agnostic to whether an archive arrived as one zip
 * (Instagram) or many parts (Facebook).
 */
export interface ArchiveReader {
  listEntries(): EntryHeader[];
  hasEntry(name: string): boolean;
  readEntryText(name: string): Promise<string>;
  close(): Promise<void>;
}

/**
 * WebView-side mirror of the Phase 0 `ArchiveReader` (src/parsers/shared/archive.ts),
 * backed by Rust `archive_*` commands instead of yauzl. Entry headers are fetched
 * once on open so `listEntries`/`hasEntry` stay synchronous for the parsers; only
 * `readEntryText` crosses IPC per call.
 */
export class TauriArchiveReader implements ArchiveReader {
  private constructor(
    private readonly handle: number,
    private readonly entries: EntryHeader[],
    private readonly names: Set<string>,
  ) {}

  static async open(path: string): Promise<TauriArchiveReader> {
    const handle = await invoke<number>("archive_open", { path });
    const entries = await invoke<EntryHeader[]>("archive_list_entries", { handle });
    return new TauriArchiveReader(handle, entries, new Set(entries.map((e) => e.fileName)));
  }

  listEntries(): EntryHeader[] {
    return this.entries;
  }

  hasEntry(name: string): boolean {
    return this.names.has(name);
  }

  readEntryText(name: string): Promise<string> {
    return invoke<string>("archive_read_text", { handle: this.handle, name });
  }

  async close(): Promise<void> {
    await invoke("archive_close", { handle: this.handle });
  }
}

/**
 * One logical archive spanning multiple zip "parts" (Phase 2 / Facebook: Meta
 * splits a single DYI tree across many independent zips — media in most parts,
 * JSON metadata in one). Opens every part as its own {@link TauriArchiveReader}
 * and presents the union as a single reader. Parts are cleanly partitioned (a
 * given path lives in exactly one part); a collision means the wrong file set
 * was selected, so we fail loudly rather than silently pick one. A one-element
 * list behaves identically to a single-zip archive (the Instagram path).
 */
export class MergedArchiveReader implements ArchiveReader {
  private constructor(
    private readonly parts: TauriArchiveReader[],
    private readonly entries: EntryHeader[],
    private readonly owner: Map<string, TauriArchiveReader>,
  ) {}

  static async open(paths: string[]): Promise<MergedArchiveReader> {
    if (paths.length === 0) {
      throw new Error("MergedArchiveReader.open: no archive parts given");
    }
    const parts: TauriArchiveReader[] = [];
    try {
      for (const path of paths) {
        parts.push(await TauriArchiveReader.open(path));
      }
      const entries: EntryHeader[] = [];
      const owner = new Map<string, TauriArchiveReader>();
      for (const part of parts) {
        for (const entry of part.listEntries()) {
          if (owner.has(entry.fileName)) {
            throw new Error(`duplicate entry across archive parts: ${entry.fileName}`);
          }
          owner.set(entry.fileName, part);
          entries.push(entry);
        }
      }
      return new MergedArchiveReader(parts, entries, owner);
    } catch (e) {
      await Promise.allSettled(parts.map((p) => p.close()));
      throw e;
    }
  }

  listEntries(): EntryHeader[] {
    return this.entries;
  }

  hasEntry(name: string): boolean {
    return this.owner.has(name);
  }

  readEntryText(name: string): Promise<string> {
    const part = this.owner.get(name);
    if (!part) {
      return Promise.reject(new Error(`entry not found in any archive part: ${name}`));
    }
    return part.readEntryText(name);
  }

  async close(): Promise<void> {
    await Promise.allSettled(this.parts.map((p) => p.close()));
  }
}
