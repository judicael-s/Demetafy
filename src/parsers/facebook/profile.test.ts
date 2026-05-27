import { describe, it, expect } from 'vitest';
import { parseFacebookProfile } from './profile.js';

describe('parseFacebookProfile', () => {
  it('parses profile_v2 (name, emails, birthday, city, relationship) with mojibake fix', () => {
    const json = {
      profile_v2: {
        name: { full_name: 'Alex Rivera', first_name: 'Alex', middle_name: '', last_name: 'Rivera' },
        emails: { emails: ['alex.rivera@example.com', 'alex.rivera@example.org'], previous_emails: [] },
        birthday: { year: 1990, month: 1, day: 1 },
        gender: { gender_option: 'MALE', pronoun: 'MALE' },
        current_city: { name: 'Sampleville', timestamp: 0 },
        hometown: { name: 'Paris', timestamp: 0 },
        relationship: { status: 'CÃ©libataire', timestamp: 1433511463 }, // Célibataire
        previous_names: [{ name: 'Alex Strump Rivera', timestamp: 1305065698 }],
      },
    };
    expect(parseFacebookProfile(json)).toEqual({
      fullName: 'Alex Rivera',
      firstName: 'Alex',
      lastName: 'Rivera',
      emails: ['alex.rivera@example.com', 'alex.rivera@example.org'],
      dateOfBirth: '1990-01-01',
      gender: 'MALE',
      currentCity: 'Sampleville',
      hometown: 'Paris',
      relationshipStatus: 'Célibataire',
      previousNames: [{ name: 'Alex Strump Rivera', timestamp: 1305065698 }],
    });
  });

  it('is lenient: missing profile_v2 / empty / null yields a blank profile', () => {
    const blank = { fullName: '', firstName: '', lastName: '', emails: [], previousNames: [] };
    expect(parseFacebookProfile({})).toEqual(blank);
    expect(parseFacebookProfile(null)).toEqual(blank);
    expect(parseFacebookProfile({ profile_v2: {} })).toEqual(blank);
  });

  it('skips a zero/absent birthday year rather than emitting a bogus date', () => {
    expect(parseFacebookProfile({ profile_v2: { birthday: { year: 0, month: 0, day: 0 } } }).dateOfBirth).toBeUndefined();
  });
});
