import yauzl from 'yauzl';
import type { ZipFile, Entry } from 'yauzl';
import type { Readable } from 'node:stream';

export interface EntryHeader {
  fileName: string;
  uncompressedSize: number;
  compressedSize: number;
  lastModified: Date;
}

/**
 * Random-access reader over a Meta DYI .zip archive.
 *
 * Walks all entry headers up front (cheap — headers are small even for 100K+ entry
 * archives) and keeps the ZipFile open for streaming per-entry reads. Caller must
 * call `close()` when done.
 *
 * Streaming-first: per-entry reads return a Readable, never buffer the whole entry.
 * The convenience `readEntryText` buffers because text files are bounded; media
 * goes through `readEntryStream` to keep memory flat against 50–100 GB archives
 * (architecture.md risks).
 */
export class ArchiveReader {
  private constructor(
    private readonly zip: ZipFile,
    private readonly entries: Map<string, Entry>,
  ) {}

  static async open(zipPath: string): Promise<ArchiveReader> {
    const zip = await new Promise<ZipFile>((resolve, reject) => {
      yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (err, z) => {
        if (err) reject(err);
        else if (!z) reject(new Error(`yauzl returned no ZipFile for ${zipPath}`));
        else resolve(z);
      });
    });

    const entries = await new Promise<Map<string, Entry>>((resolve, reject) => {
      const map = new Map<string, Entry>();
      zip.on('entry', (entry: Entry) => {
        map.set(entry.fileName, entry);
        zip.readEntry();
      });
      zip.on('end', () => resolve(map));
      zip.on('error', reject);
      zip.readEntry();
    });

    return new ArchiveReader(zip, entries);
  }

  /** All entry headers in the archive (directories + files). */
  listEntries(): EntryHeader[] {
    return [...this.entries.values()].map((e) => ({
      fileName: e.fileName,
      uncompressedSize: e.uncompressedSize,
      compressedSize: e.compressedSize,
      lastModified: e.getLastModDate(),
    }));
  }

  hasEntry(entryPath: string): boolean {
    return this.entries.has(entryPath);
  }

  /**
   * Buffer a single entry to a UTF-8 string. Use for JSON / text only.
   *
   * NOTE: Uses explicit event listeners (not `for await (const chunk of stream)`).
   * yauzl 3.x ReadStreams hang silently with for-await-of — no data, no end, no
   * error event. See `tasks/lessons.md`. Found in Demetafy Phase 0 on 2026-05-19.
   */
  async readEntryText(entryPath: string): Promise<string> {
    const stream = await this.readEntryStream(entryPath);
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      stream.on('error', reject);
    });
  }

  /** Open a streaming readable for a single entry. Caller consumes & disposes. */
  readEntryStream(entryPath: string): Promise<Readable> {
    const entry = this.entries.get(entryPath);
    if (!entry) {
      return Promise.reject(new Error(`Entry not found in archive: ${entryPath}`));
    }
    return new Promise((resolve, reject) => {
      this.zip.openReadStream(entry, (err, stream) => {
        if (err) reject(err);
        else if (!stream) reject(new Error(`yauzl returned no stream for ${entryPath}`));
        else resolve(stream);
      });
    });
  }

  close(): void {
    this.zip.close();
  }
}

/**
 * Best-effort multi-part detection. Meta splits large DYIs into multiple .zip parts;
 * the naming convention isn't publicly documented, so this matches common patterns
 * (`*_part1.zip`, `*-part1.zip`, etc.) without claiming completeness.
 *
 * TODO(phase0-step2): when we hit a real multi-part archive, implement assembly here.
 * Today: detect, warn, fail closed. Alex' first archive is single-part so untested.
 */
export function detectMultiPart(zipPath: string): {
  isMultiPart: boolean;
  siblingPattern?: string;
} {
  const m = /(.+?)[-_]?part\d+\.zip$/i.exec(zipPath);
  if (m) {
    return { isMultiPart: true, siblingPattern: `${m[1]}*part*.zip` };
  }
  return { isMultiPart: false };
}
