import { describe, it, expect } from 'vitest';
import { parseThread, parseThreadFiles } from './messages.js';

const baseThread = {
  participants: [{ name: 'alice' }, { name: 'bob' }],
  title: 'alice',
  thread_path: 'inbox/alice_123',
  is_still_participant: true,
  magic_words: [],
};

describe('parseThread', () => {
  it('parses participants, title, thread_path, and sorts messages oldest-first', () => {
    const t = parseThread({
      ...baseThread,
      messages: [
        { sender_name: 'alice', timestamp_ms: 3000, content: 'third' },
        { sender_name: 'bob', timestamp_ms: 1000, content: 'first' },
        { sender_name: 'alice', timestamp_ms: 2000, content: 'second' },
      ],
    });
    expect(t.participants).toEqual(['alice', 'bob']);
    expect(t.title).toBe('alice');
    expect(t.threadPath).toBe('inbox/alice_123');
    expect(t.isStillParticipant).toBe(true);
    expect(t.messages.map((m) => m.content)).toEqual(['first', 'second', 'third']);
  });

  it('de-mojibake’s participant names, title, and message content', () => {
    const t = parseThread({
      participants: [{ name: 'cafÃ©' }, { name: 'example.user' }],
      title: 'cafÃ©',
      thread_path: 'inbox/cafe_1',
      messages: [
        { sender_name: 'cafÃ©', timestamp_ms: 1, content: 'faire Ã§a' },
      ],
    });
    expect(t.participants).toEqual(['café', 'example.user']);
    expect(t.title).toBe('café');
    expect(t.messages[0]?.sender).toBe('café');
    expect(t.messages[0]?.content).toBe('faire ça');
  });

  it('extracts reactions and de-mojibake’s the emoji + actor name', () => {
    const t = parseThread({
      ...baseThread,
      messages: [
        {
          sender_name: 'alice',
          timestamp_ms: 1000,
          content: 'Merci',
          // ❤️ = U+2764 U+FE0F, UTF-8 bytes E2 9D A4 EF B8 8F, emitted by Meta
          // as 6 separate Latin-1 \u00XX escapes. Use explicit \u for unambiguous
          // bytes (typing the rendered chars varies by editor/encoding).
          reactions: [
            {
              reaction: 'â¤ï¸',
              actor: 'cafÃ©',
              timestamp: 1500,
            },
          ],
        },
      ],
    });
    expect(t.messages[0]?.reactions).toEqual([
      { reaction: '❤️', actor: 'café', timestamp: 1500 },
    ]);
  });

  it('captures audio/photo/video/gif media refs', () => {
    const t = parseThread({
      ...baseThread,
      messages: [
        {
          sender_name: 'alice',
          timestamp_ms: 1000,
          audio_files: [{ uri: 'inbox/.../audio/x.mp4', creation_timestamp: 100 }],
          photos: [{ uri: 'inbox/.../photos/y.jpg', creation_timestamp: 200 }],
          videos: [{ uri: 'inbox/.../videos/z.mp4', creation_timestamp: 300 }],
          gifs: [{ uri: 'inbox/.../gifs/w.gif', creation_timestamp: 400 }],
        },
      ],
    });
    const m = t.messages[0]!;
    expect(m.audioFiles).toEqual([{ uri: 'inbox/.../audio/x.mp4', creationTimestamp: 100 }]);
    expect(m.photos[0]?.uri).toBe('inbox/.../photos/y.jpg');
    expect(m.videos[0]?.creationTimestamp).toBe(300);
    expect(m.gifs[0]?.uri).toBe('inbox/.../gifs/w.gif');
    expect(m.content).toBeUndefined(); // media-only message
  });

  it('captures shared content with mojibake fix on share text', () => {
    const t = parseThread({
      ...baseThread,
      messages: [
        {
          sender_name: 'alice',
          timestamp_ms: 1000,
          share: { link: 'https://example.com', share_text: 'aimÃ©' },
        },
      ],
    });
    expect(t.messages[0]?.share).toEqual({
      link: 'https://example.com',
      shareText: 'aimé',
    });
  });

  it('handles group threads with more than two participants', () => {
    const t = parseThread({
      participants: [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }],
      title: 'group chat',
      messages: [{ sender_name: 'a', timestamp_ms: 1, content: 'hi all' }],
    });
    expect(t.participants).toEqual(['a', 'b', 'c', 'd']);
  });

  it('skips malformed messages (missing sender or timestamp)', () => {
    const t = parseThread({
      ...baseThread,
      messages: [
        { sender_name: 'alice', timestamp_ms: 1000, content: 'good' },
        { content: 'missing sender' },
        { sender_name: 'bob' /* missing timestamp */ },
      ],
    });
    expect(t.messages).toHaveLength(1);
    expect(t.messages[0]?.content).toBe('good');
  });

  it('returns empty arrays for missing optional sections', () => {
    const t = parseThread({
      ...baseThread,
      messages: [{ sender_name: 'alice', timestamp_ms: 1000, content: 'hi' }],
    });
    const m = t.messages[0]!;
    expect(m.reactions).toEqual([]);
    expect(m.audioFiles).toEqual([]);
    expect(m.photos).toEqual([]);
    expect(m.videos).toEqual([]);
    expect(m.gifs).toEqual([]);
    expect(m.share).toBeUndefined();
  });

  it('throws on non-object root', () => {
    expect(() => parseThread([])).toThrow(/object root/);
    expect(() => parseThread('hello')).toThrow(/object root/);
    expect(() => parseThread(null)).toThrow(/object root/);
  });
});

describe('parseThreadFiles', () => {
  it('concatenates messages from multi-file threads in chronological order', () => {
    // Meta writes message_1.json with newest batch, message_2.json with older batch
    const newer = {
      ...baseThread,
      messages: [
        { sender_name: 'a', timestamp_ms: 5000, content: 'recent' },
        { sender_name: 'a', timestamp_ms: 4000, content: 'less recent' },
      ],
    };
    const older = {
      ...baseThread,
      messages: [
        { sender_name: 'a', timestamp_ms: 2000, content: 'older' },
        { sender_name: 'a', timestamp_ms: 1000, content: 'oldest' },
      ],
    };
    const t = parseThreadFiles([newer, older]);
    expect(t.messages.map((m) => m.content)).toEqual([
      'oldest',
      'older',
      'less recent',
      'recent',
    ]);
    expect(t.participants).toEqual(['alice', 'bob']);
  });

  it('throws on empty input', () => {
    expect(() => parseThreadFiles([])).toThrow(/no inputs/);
  });
});
