import { describe, it, expect } from 'vitest';
import { esc, fmtDate, fmtDateTime, layout, pager } from './render.js';

describe('esc', () => {
  it('escapes all HTML-sensitive characters', () => {
    expect(esc(`<script>alert("x") & 'y'</script>`)).toBe(
      '&lt;script&gt;alert(&quot;x&quot;) &amp; &#39;y&#39;&lt;/script&gt;',
    );
  });
  it('passes plain text unchanged', () => {
    expect(esc('Hello world')).toBe('Hello world');
  });
  it('handles empty strings', () => {
    expect(esc('')).toBe('');
  });
});

describe('fmtDate', () => {
  it('formats unix ms to YYYY-MM-DD', () => {
    expect(fmtDate(1700000000000)).toBe('2023-11-14');
  });
});

describe('fmtDateTime', () => {
  it('formats unix ms to YYYY-MM-DD HH:MM', () => {
    const out = fmtDateTime(1700000000000);
    expect(out).toMatch(/^2023-11-14 \d{2}:\d{2}$/);
  });
});

describe('layout', () => {
  it('escapes the title and embeds the body verbatim', () => {
    const html = layout('<bad>', '<div>body</div>');
    expect(html).toContain('<title>&lt;bad&gt; — Demetafy</title>');
    expect(html).toContain('<div>body</div>');
  });

  it('marks the current nav item active', () => {
    const html = layout('Saved', '', 'saved');
    expect(html).toMatch(/<a href="\/saved" class="active">saved<\/a>/);
    expect(html).toMatch(/<a href="\/" class="">overview<\/a>/);
  });
});

describe('pager', () => {
  it('returns empty when there is one or zero pages', () => {
    expect(pager(1, 1, '/x')).toBe('');
    expect(pager(1, 0, '/x')).toBe('');
  });

  it('shows prev + page count on a middle page', () => {
    const html = pager(3, 5, '/saved');
    expect(html).toContain('href="/saved?p=2"');
    expect(html).toContain('href="/saved?p=4"');
    expect(html).toContain('page 3 of 5');
  });

  it('omits prev on first page', () => {
    expect(pager(1, 5, '/x')).not.toContain('prev');
  });

  it('omits next on last page', () => {
    expect(pager(5, 5, '/x')).not.toContain('next');
  });
});
