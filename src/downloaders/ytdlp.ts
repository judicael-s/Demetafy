import { spawn, type SpawnOptions } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Outcome of one yt-dlp invocation. Categorization is best-effort, based on
 * scanning yt-dlp's stderr — Meta's error text drifts; treat the pattern list
 * as a starting point and expand when we see new ones in the wild.
 *
 *  - `ok`         : file downloaded successfully
 *  - `skipped`    : a file matching the URL's media id already existed in outputDir
 *  - `dead`       : the post is gone (404 / "Video unavailable" / deleted) — DO NOT retry
 *  - `loginWalled`: needs authenticated cookies — DO NOT retry without `--cookies`
 *  - `transient`  : network / rate-limit / temporary — eligible for retry
 *  - `unknown`    : nonzero exit we couldn't categorize — DO NOT retry, surface for triage
 */
export type DownloadResult =
  | { kind: 'ok'; outputPath: string; durationMs: number }
  | { kind: 'skipped'; outputPath: string }
  | { kind: 'dead'; reason: string }
  | { kind: 'loginWalled'; reason: string }
  | { kind: 'transient'; reason: string }
  | { kind: 'unknown'; reason: string; exitCode: number };

export interface RunYtdlpOptions {
  cookiesPath?: string;
  ytdlpPath?: string;
  /** Test seam — inject a fake spawn for unit tests. */
  spawnFn?: typeof spawn;
}

/** Match `/reel/<id>`, `/p/<id>`, `/tv/<id>` from an Instagram permalink. */
export function extractInstagramId(url: string): string | null {
  const m = /\/(reel|p|tv)\/([^/?#]+)/i.exec(url);
  return m && m[2] ? m[2] : null;
}

/**
 * Classify a yt-dlp failure by scanning stderr. Returns the result kind plus
 * a one-line reason. Patterns are conservative — anything we don't recognize
 * is reported as `unknown` rather than guessed.
 */
export function categorize(stderr: string, exitCode: number): DownloadResult {
  const lower = stderr.toLowerCase();
  const reason = stderr.trim().split('\n').pop()?.slice(0, 300) ?? '';

  const isDead =
    lower.includes('video unavailable') ||
    lower.includes('post is no longer available') ||
    lower.includes('has been deleted') ||
    lower.includes('content is not available') ||
    lower.includes('does not exist') ||
    lower.includes('http error 404') ||
    lower.includes('http error 410');

  if (isDead) return { kind: 'dead', reason };

  const isLoginWalled =
    lower.includes('login required') ||
    lower.includes('login_required') ||
    lower.includes('requested content is not available') ||
    lower.includes('restricted video') ||
    lower.includes('sign in') ||
    lower.includes('private') ||
    lower.includes('use --cookies') ||
    lower.includes('cookies') ||
    lower.includes('rate-limit reached') ||
    lower.includes('login to access');

  if (isLoginWalled) return { kind: 'loginWalled', reason };

  const isTransient =
    lower.includes('connection') ||
    lower.includes('timeout') ||
    lower.includes('temporarily unavailable') ||
    lower.includes('network') ||
    lower.includes('http error 5') ||
    lower.includes('http error 429') ||
    lower.includes('too many requests');

  if (isTransient) return { kind: 'transient', reason };

  return { kind: 'unknown', reason, exitCode };
}

async function findExistingFile(outputDir: string, id: string): Promise<string | null> {
  try {
    const entries = await readdir(outputDir);
    const match = entries.find((e) => e.startsWith(`${id}.`));
    return match ? path.join(outputDir, match) : null;
  } catch {
    return null; // dir doesn't exist
  }
}

/**
 * Run yt-dlp once against a single URL. Skips if a file matching the URL's
 * Instagram media id already exists in `outputDir`. Creates `outputDir` if missing.
 */
export async function runYtdlp(
  url: string,
  outputDir: string,
  opts: RunYtdlpOptions = {},
): Promise<DownloadResult> {
  const id = extractInstagramId(url);
  if (id) {
    const existing = await findExistingFile(outputDir, id);
    if (existing) return { kind: 'skipped', outputPath: existing };
  }

  mkdirSync(outputDir, { recursive: true });

  const args = [
    '--no-warnings',
    '--no-overwrites',
    '-o',
    `${outputDir.replace(/\\/g, '/')}/%(id)s.%(ext)s`,
  ];
  if (opts.cookiesPath) args.push('--cookies', opts.cookiesPath);
  args.push(url);

  const spawnFn = opts.spawnFn ?? spawn;
  const cmd = opts.ytdlpPath ?? 'yt-dlp';
  const start = Date.now();
  const spawnOpts: SpawnOptions = { stdio: ['ignore', 'pipe', 'pipe'] };

  return new Promise((resolve) => {
    const proc = spawnFn(cmd, args, spawnOpts);
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on('error', (err: Error) => {
      resolve({ kind: 'unknown', reason: `spawn failed: ${err.message}`, exitCode: -1 });
    });
    proc.on('close', async (exitCode: number | null) => {
      const code = exitCode ?? -1;
      const durationMs = Date.now() - start;

      if (code === 0) {
        // Prefer the Destination line yt-dlp prints; fall back to globbing the dir.
        const destMatch = /\[download\] Destination:\s+(.+)/i.exec(stdout);
        if (destMatch?.[1]) {
          resolve({ kind: 'ok', outputPath: destMatch[1].trim(), durationMs });
          return;
        }
        if (id) {
          const found = await findExistingFile(outputDir, id);
          if (found) {
            const alreadyDownloaded = /has already been downloaded/i.test(stdout);
            resolve(
              alreadyDownloaded
                ? { kind: 'skipped', outputPath: found }
                : { kind: 'ok', outputPath: found, durationMs },
            );
            return;
          }
        }
        resolve({
          kind: 'unknown',
          reason: 'yt-dlp exited 0 but no output file found',
          exitCode: 0,
        });
        return;
      }

      resolve(categorize(stderr, code));
    });
  });
}

export interface RetryOptions extends RunYtdlpOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  /** Test seam — replaces `setTimeout` for deterministic retry tests. */
  delayFn?: (ms: number) => Promise<void>;
  /** Test seam — replaces `runYtdlp` so we can verify retry behavior in isolation. */
  runFn?: typeof runYtdlp;
}

/**
 * Run with exponential backoff on `transient` errors only. Permanent outcomes
 * (`dead`, `loginWalled`, `unknown`) short-circuit immediately — retrying them
 * would waste cycles and risk extra rate-limit penalties.
 */
export async function runYtdlpWithRetry(
  url: string,
  outputDir: string,
  opts: RetryOptions = {},
): Promise<DownloadResult> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 1000;
  const delay = opts.delayFn ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const run = opts.runFn ?? runYtdlp;

  let last: DownloadResult = { kind: 'transient', reason: 'never ran' };
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    last = await run(url, outputDir, opts);
    if (last.kind !== 'transient') return last;
    if (attempt < maxAttempts) await delay(baseDelayMs * 2 ** (attempt - 1));
  }
  return last;
}

/** Verify yt-dlp is available on PATH. Returns the version string or null. */
export async function checkYtdlpAvailable(
  opts: { ytdlpPath?: string; spawnFn?: typeof spawn } = {},
): Promise<string | null> {
  const cmd = opts.ytdlpPath ?? 'yt-dlp';
  const spawnFn = opts.spawnFn ?? spawn;
  return new Promise((resolve) => {
    let stdout = '';
    try {
      const proc = spawnFn(cmd, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
      proc.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      proc.on('error', () => resolve(null));
      proc.on('close', (code: number | null) => {
        resolve(code === 0 ? stdout.trim() : null);
      });
    } catch {
      resolve(null);
    }
  });
}
