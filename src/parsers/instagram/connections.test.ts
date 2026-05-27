import { describe, it, expect } from 'vitest';
import { parseConnections } from './connections.js';

describe('parseConnections', () => {
  it('parses the top-level-array shape (followers) using string_list_data.value', () => {
    const json = [
      {
        title: '',
        media_list_data: [],
        string_list_data: [
          { href: 'https://www.instagram.com/pops_fd', value: 'pops_fd', timestamp: 1778281081 },
        ],
      },
    ];
    expect(parseConnections(json, 'followers')).toEqual([
      {
        kind: 'followers',
        username: 'pops_fd',
        href: 'https://www.instagram.com/pops_fd',
        timestamp: 1778281081,
      },
    ]);
  });

  it('parses the relationships_* object shape (following), title as handle, strips /_u/', () => {
    const json = {
      relationships_following: [
        {
          title: 'adrienbroner',
          string_list_data: [
            { href: 'https://www.instagram.com/_u/adrienbroner', timestamp: 1778680816 },
          ],
        },
      ],
    };
    expect(parseConnections(json, 'following')).toEqual([
      {
        kind: 'following',
        username: 'adrienbroner',
        href: 'https://www.instagram.com/adrienbroner',
        timestamp: 1778680816,
      },
    ]);
  });

  it('fixes mojibake in handles/titles', () => {
    const json = [{ string_list_data: [{ href: 'https://www.instagram.com/cafe', value: 'CafÃ©' }] }];
    expect(parseConnections(json, 'followers')[0]?.username).toBe('Café');
  });

  it('falls back to the href slug when value and title are absent', () => {
    const json = [{ string_list_data: [{ href: 'https://www.instagram.com/_u/some.user' }] }];
    const c = parseConnections(json, 'blocked')[0];
    expect(c?.username).toBe('some.user');
    expect(c?.href).toBe('https://www.instagram.com/some.user');
    expect(c?.timestamp).toBe(0);
  });

  it('skips entries with no resolvable username and tolerates empty/odd input', () => {
    expect(parseConnections([{ string_list_data: [] }, { title: '' }], 'followers')).toEqual([]);
    expect(parseConnections({}, 'following')).toEqual([]);
    expect(parseConnections(null, 'followers')).toEqual([]);
  });
});
