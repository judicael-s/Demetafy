import { describe, it, expect } from 'vitest';
import { parseThreadFiles, FACEBOOK_THREAD_CATEGORIES } from './messages.js';

describe('Facebook messages (reuses the Instagram thread parser)', () => {
  it('parses a real-shape FB thread: mojibake-fixed, sorted oldest-first, tolerates blank participant', () => {
    const thread = parseThreadFiles([
      {
        participants: [{ name: '' }, { name: 'Alex Rivera' }],
        title: '',
        thread_path: 'inbox/10224159929012391',
        is_still_participant: true,
        messages: [
          {
            sender_name: 'Alex Rivera',
            timestamp_ms: 1585823006433,
            content: "Je dÃ©cale la, je t'appels quand j'arrive", // décale
          },
          {
            sender_name: 'Alex Rivera',
            timestamp_ms: 1585821494606,
            content: 'Je vais pas tarder Ã  dÃ©cale', // tarder à décale
          },
        ],
      },
    ]);

    expect(thread.participants).toEqual(['', 'Alex Rivera']);
    expect(thread.threadPath).toBe('inbox/10224159929012391');
    expect(thread.messages.map((m) => m.content)).toEqual([
      'Je vais pas tarder à décale',
      "Je décale la, je t'appels quand j'arrive",
    ]);
  });

  it('exposes the FB thread categories incl. the inline e2ee_cutover bucket', () => {
    expect([...FACEBOOK_THREAD_CATEGORIES]).toEqual([
      'inbox',
      'archived_threads',
      'filtered_threads',
      'message_requests',
      'e2ee_cutover',
    ]);
  });
});
