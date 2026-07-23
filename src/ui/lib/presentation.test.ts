import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DATE_UNAVAILABLE,
  buttonClasses,
  formatArchiveMonth,
  formatArchiveTimestamp,
} from './presentation';

const appCss = readFileSync(new URL('../app.css', import.meta.url), 'utf8');

describe('buttonClasses', () => {
  it('keeps a visible focus treatment on every variant', () => {
    for (const variant of ['primary', 'secondary', 'ghost', 'danger'] as const) {
      expect(buttonClasses(variant, 'md')).toContain('focus-visible:outline');
    }
  });

  it('gives medium controls a 40px minimum target', () => {
    expect(buttonClasses('secondary', 'md')).toContain('min-h-10');
  });

  it('keeps the primary label on a solid accessible accent surface', () => {
    expect(appCss).toContain(
      'linear-gradient(var(--color-accent), var(--color-accent)) padding-box',
    );
    expect(appCss).toContain('var(--ig-gradient) border-box');
    expect(appCss).toContain('border: 1px solid transparent');
  });

  it('ships every semantic token instead of pruning unused utilities', () => {
    expect(appCss).toContain('@theme static');
  });
});

describe('archive chronology', () => {
  const deterministic = { locale: 'en-GB', timeZone: 'UTC' } as const;

  it('formats millisecond timestamps with a medium date and short time', () => {
    expect(formatArchiveTimestamp(Date.UTC(2026, 4, 19, 14, 5), deterministic)).toBe(
      '19 May 2026, 14:05',
    );
  });

  it('preserves Unix-second timestamps emitted by Facebook exports', () => {
    expect(formatArchiveTimestamp(1_779_199_500, deterministic)).toBe('19 May 2026, 14:05');
  });

  it('formats chronology group headers as month and year', () => {
    expect(formatArchiveMonth(Date.UTC(2026, 4, 19), deterministic)).toBe('May 2026');
  });

  it('only explains missing chronology when the surface asks for it', () => {
    expect(formatArchiveTimestamp(null, deterministic)).toBe('');
    expect(formatArchiveTimestamp(null, { ...deterministic, explainMissing: true })).toBe(
      DATE_UNAVAILABLE,
    );
    expect(DATE_UNAVAILABLE).toBe('Date unavailable');
  });
});
