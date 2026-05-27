import { describe, it, expect } from 'vitest';
import { parseProfile, parseProfileChanges } from './profile.js';

describe('parseProfile', () => {
  it('extracts core fields from personal_information.json', () => {
    const profile = parseProfile(
      {
        profile_user: [
          {
            string_map_data: {
              Username: { value: 'example_user' },
              Name: { value: 'example.user' },
              'Email address': { value: 'alex@example.com' },
              'Phone number': { value: '+33...' },
              Gender: { value: 'male' },
              'Date of birth': { value: '1990-01-01' },
              'Private account': { value: 'False' },
            },
            media_map_data: {
              'Profile photo': {
                uri: 'media/profile/202604/x.jpg',
                creation_timestamp: 1776324432,
              },
            },
          },
        ],
      },
      null,
    );
    expect(profile).toMatchObject({
      username: 'example_user',
      displayName: 'example.user',
      email: 'alex@example.com',
      phone: '+33...',
      gender: 'male',
      dateOfBirth: '1990-01-01',
      isPrivateAccount: false,
      profilePhotoUri: 'media/profile/202604/x.jpg',
    });
    expect(profile.profilePhotoTakenAt?.getTime()).toBe(1776324432 * 1000);
  });

  it('flags private accounts correctly', () => {
    const p = parseProfile(
      {
        profile_user: [
          { string_map_data: { Username: { value: 'x' }, 'Private account': { value: 'True' } } },
        ],
      },
      null,
    );
    expect(p.isPrivateAccount).toBe(true);
  });

  it('de-mojibake’s display name', () => {
    const p = parseProfile(
      {
        profile_user: [
          { string_map_data: { Username: { value: 'x' }, Name: { value: 'cafÃ©' } } },
        ],
      },
      null,
    );
    expect(p.displayName).toBe('café');
  });

  it('merges instagram_profile_information.json into the same Profile', () => {
    const p = parseProfile(
      { profile_user: [{ string_map_data: { Username: { value: 'x' }, Name: { value: 'X' } } }] },
      {
        fbid: '17862665122189619',
        label_values: [
          { label: 'First country code', value: 'FR' },
          { label: 'Last login', timestamp_value: 1778739460 },
          { label: 'Last logout', timestamp_value: 1640034889 },
          { label: 'First story time', timestamp_value: 1581611835 },
          { label: 'Last story time', timestamp_value: 1738593759 },
          { label: 'Do you have any archived Reels?', value: 'True' },
        ],
      },
    );
    expect(p.countryCode).toBe('FR');
    expect(p.fbid).toBe('17862665122189619');
    expect(p.hasArchivedReels).toBe(true);
    expect(p.firstStoryAt?.getTime()).toBe(1581611835 * 1000);
    expect(p.lastLoginAt?.getTime()).toBe(1778739460 * 1000);
  });

  it('tolerates missing files (both null)', () => {
    const p = parseProfile(null, null);
    expect(p).toEqual({ username: '', displayName: '', isPrivateAccount: false });
  });
});

describe('parseProfileChanges', () => {
  it('extracts profile change history and sorts newest-first', () => {
    const changes = parseProfileChanges({
      profile_profile_change: [
        {
          string_map_data: {
            Changed: { value: 'Username' },
            'Previous value': { value: '' },
            'New value': { value: 'example_user' },
            'Change date': { timestamp: 1776324398 },
          },
        },
        {
          string_map_data: {
            Changed: { value: 'Profile Name' },
            'Previous value': { value: 'Alex Rivera' },
            'New value': { value: 'example.user' },
            'Change date': { timestamp: 1776324374 },
          },
        },
      ],
    });
    expect(changes).toHaveLength(2);
    expect(changes[0]?.field).toBe('Username'); // newer
    expect(changes[1]?.field).toBe('Profile Name'); // older
    expect(changes[1]?.previousValue).toBe('Alex Rivera');
  });

  it('returns empty when section is missing', () => {
    expect(parseProfileChanges({})).toEqual([]);
  });

  it('throws on non-object root', () => {
    expect(() => parseProfileChanges([])).toThrow(/object root/);
  });

  it('de-mojibake’s previous/new values', () => {
    const changes = parseProfileChanges({
      profile_profile_change: [
        {
          string_map_data: {
            Changed: { value: 'Name' },
            'Previous value': { value: 'cafÃ©' },
            'New value': { value: 'Ã©caf' },
            'Change date': { timestamp: 1 },
          },
        },
      ],
    });
    expect(changes[0]?.previousValue).toBe('café');
    expect(changes[0]?.newValue).toBe('écaf');
  });
});
