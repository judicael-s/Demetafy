import { describe, it, expect, vi } from 'vitest';
import {
  extractInstagramId,
  categorize,
  runYtdlpWithRetry,
  type DownloadResult,
} from './ytdlp.js';

describe('extractInstagramId', () => {
  it.each([
    ['https://www.instagram.com/reel/DW3cSqIlB7O/', 'DW3cSqIlB7O'],
    ['https://www.instagram.com/p/DYJ9TJ-CIqc/', 'DYJ9TJ-CIqc'],
    ['https://www.instagram.com/tv/ABC123/', 'ABC123'],
    ['https://instagram.com/reel/xyz/?utm_source=ig', 'xyz'],
    ['https://www.instagram.com/reel/abc#fragment', 'abc'],
  ])('extracts %s → %s', (url, expected) => {
    expect(extractInstagramId(url)).toBe(expected);
  });

  it('returns null for non-permalink URLs', () => {
    expect(extractInstagramId('https://www.instagram.com/example_user/')).toBeNull();
    expect(extractInstagramId('https://example.com/reel/xyz/')).not.toBeNull(); // not Instagram-specific
  });
});

describe('categorize', () => {
  it('flags "Video unavailable" as dead', () => {
    expect(categorize('ERROR: [Instagram] Video unavailable', 1).kind).toBe('dead');
  });

  it('flags 404 as dead', () => {
    expect(categorize('ERROR: HTTP Error 404: Not Found', 1).kind).toBe('dead');
  });

  it('flags 410 (gone) as dead', () => {
    expect(categorize('ERROR: HTTP Error 410: Gone', 1).kind).toBe('dead');
  });

  it('flags "Login required" as loginWalled', () => {
    expect(categorize('ERROR: Login required to access this content', 1).kind).toBe('loginWalled');
  });

  it('flags rate-limit reached as loginWalled (caller should switch to cookies)', () => {
    expect(categorize('ERROR: rate-limit reached', 1).kind).toBe('loginWalled');
  });

  it('flags timeout as transient', () => {
    expect(categorize('ERROR: read timeout', 1).kind).toBe('transient');
  });

  it('flags 5xx as transient', () => {
    expect(categorize('ERROR: HTTP Error 503: Service Unavailable', 1).kind).toBe('transient');
  });

  it('flags HTTP 429 (rate limit) as transient — hit live against Instagram 2026-05-19', () => {
    expect(
      categorize('ERROR: unable to download video data: HTTP Error 429: Too Many Requests', 1)
        .kind,
    ).toBe('transient');
  });

  it('flags unrecognized errors as unknown with the exit code', () => {
    const r = categorize('ERROR: something we have never seen before', 7);
    expect(r.kind).toBe('unknown');
    if (r.kind === 'unknown') expect(r.exitCode).toBe(7);
  });

  it('truncates extremely long stderr in the reason', () => {
    const r = categorize('ERROR: ' + 'x'.repeat(1000), 1);
    if (r.kind === 'unknown') expect(r.reason.length).toBeLessThanOrEqual(300);
  });
});

describe('runYtdlpWithRetry', () => {
  it('retries on transient and succeeds on third attempt', async () => {
    const calls: number[] = [];
    let attempt = 0;
    const runFn = vi.fn(async (): Promise<DownloadResult> => {
      attempt++;
      calls.push(attempt);
      if (attempt < 3) return { kind: 'transient', reason: 'flaky' };
      return { kind: 'ok', outputPath: '/x/abc.mp4', durationMs: 100 };
    });
    const delays: number[] = [];
    const delayFn = vi.fn(async (ms: number) => {
      delays.push(ms);
    });

    const result = await runYtdlpWithRetry('https://example/reel/abc/', '/x', {
      runFn,
      delayFn,
      maxAttempts: 3,
      baseDelayMs: 100,
    });

    expect(result.kind).toBe('ok');
    expect(calls).toEqual([1, 2, 3]);
    expect(delays).toEqual([100, 200]); // exponential: 100, 200
  });

  it('short-circuits on dead — no retries, no delays', async () => {
    let attempts = 0;
    const runFn = vi.fn(async (): Promise<DownloadResult> => {
      attempts++;
      return { kind: 'dead', reason: 'Video unavailable' };
    });
    const delayFn = vi.fn(async () => {});

    const result = await runYtdlpWithRetry('https://example/reel/abc/', '/x', {
      runFn,
      delayFn,
      maxAttempts: 3,
    });
    expect(result.kind).toBe('dead');
    expect(attempts).toBe(1);
    expect(delayFn).not.toHaveBeenCalled();
  });

  it('short-circuits on loginWalled — same rationale', async () => {
    let attempts = 0;
    const runFn = vi.fn(async (): Promise<DownloadResult> => {
      attempts++;
      return { kind: 'loginWalled', reason: 'Login required' };
    });
    const result = await runYtdlpWithRetry('https://example/reel/abc/', '/x', {
      runFn,
      delayFn: async () => {},
      maxAttempts: 3,
    });
    expect(result.kind).toBe('loginWalled');
    expect(attempts).toBe(1);
  });

  it('gives up after maxAttempts of pure transient', async () => {
    let attempts = 0;
    const runFn = vi.fn(async (): Promise<DownloadResult> => {
      attempts++;
      return { kind: 'transient', reason: 'still flaky' };
    });
    const result = await runYtdlpWithRetry('https://example/reel/abc/', '/x', {
      runFn,
      delayFn: async () => {},
      maxAttempts: 3,
    });
    expect(result.kind).toBe('transient');
    expect(attempts).toBe(3);
  });
});
