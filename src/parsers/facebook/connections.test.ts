import { describe, it, expect } from 'vitest';
import { parseFacebookConnections } from './connections.js';

describe('parseFacebookConnections', () => {
  it('parses friends_v2 ({name,timestamp}) with mojibake fix', () => {
    const json = {
      friends_v2: [
        { name: 'Sylvain Michel', timestamp: 1764449837 },
        { name: 'DÃ©lia Scopin', timestamp: 1720946573 }, // Délia
      ],
    };
    expect(parseFacebookConnections(json, 'friends')).toEqual([
      { kind: 'friends', name: 'Sylvain Michel', timestamp: 1764449837 },
      { kind: 'friends', name: 'Délia Scopin', timestamp: 1720946573 },
    ]);
  });

  it('parses following_v3 under its wrapper key and tolerates a bare array', () => {
    expect(
      parseFacebookConnections({ following_v3: [{ name: 'Konbini', timestamp: 1725342735 }] }, 'following'),
    ).toEqual([{ kind: 'following', name: 'Konbini', timestamp: 1725342735 }]);
    expect(parseFacebookConnections([{ name: 'X', timestamp: 0 }], 'friends')).toEqual([
      { kind: 'friends', name: 'X', timestamp: 0 },
    ]);
  });

  it('skips nameless/blank entries and tolerates empty/odd input', () => {
    expect(parseFacebookConnections({ friends_v2: [{ timestamp: 1 }, { name: '  ' }] }, 'friends')).toEqual([]);
    expect(parseFacebookConnections(null, 'friends')).toEqual([]);
    expect(parseFacebookConnections({}, 'friends')).toEqual([]);
  });
});
