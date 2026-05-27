import { describe, it, expect } from 'vitest';
import {
  parseFacebookAlbum,
  parseFacebookUncategorizedPhotos,
  pickProfilePhoto,
  type FacebookAlbum,
} from './photos.js';

describe('parseFacebookAlbum', () => {
  it('parses name/cover/photos and fixes mojibake, incl. decomposed C1-control accents', () => {
    const json = {
      name: 'TÃ©lÃ©chargements depuis mobile', // Téléchargements depuis mobile
      photos: [
        {
          uri: 'your_facebook_activity/posts/media/a/1.jpg',
          creation_timestamp: 1284219696,
          title: '11 sept. 2010',
          // "a" + combining grave emitted as bytes 0xCC 0x80 (the 0x80 is a C1 control) => "à"
          description: 'Photo du 63640996-09- aÌ 17.40',
        },
      ],
      cover_photo: { uri: 'your_facebook_activity/posts/media/a/1.jpg' },
      last_modified_timestamp: 1284219696,
      description: '',
    };

    const album = parseFacebookAlbum(json);
    expect(album.name).toBe('Téléchargements depuis mobile');
    expect(album.coverPhotoUri).toBe('your_facebook_activity/posts/media/a/1.jpg');
    expect(album.lastModified).toBe(1284219696);
    expect(album.photos).toHaveLength(1);
    expect(album.photos[0]?.uri).toBe('your_facebook_activity/posts/media/a/1.jpg');
    // decoded as decomposed "a"+U+0300; NFC-normalize to compare against precomposed "à"
    expect(album.photos[0]?.description?.normalize('NFC')).toBe('Photo du 63640996-09- à 17.40');
  });

  it('is lenient for null / array / missing fields', () => {
    const blank = { name: '', lastModified: 0, photos: [] };
    expect(parseFacebookAlbum(null)).toEqual(blank);
    expect(parseFacebookAlbum([])).toEqual(blank);
  });
});

describe('parseFacebookUncategorizedPhotos', () => {
  it('parses other_photos_v2 entries and skips ones with no uri', () => {
    const json = {
      other_photos_v2: [
        { uri: 'm/1.jpg', creation_timestamp: 1393675050, description: "J'aurai une petite pensÃ©e" }, // pensée
        { uri: 'm/2.jpg', creation_timestamp: 1522412884 },
        { creation_timestamp: 1 }, // no uri -> skipped
      ],
    };
    const photos = parseFacebookUncategorizedPhotos(json);
    expect(photos).toHaveLength(2);
    expect(photos[0]).toEqual({ uri: 'm/1.jpg', creationTimestamp: 1393675050, description: "J'aurai une petite pensée" });
    expect(photos[1]).toEqual({ uri: 'm/2.jpg', creationTimestamp: 1522412884 });
  });

  it('returns [] for empty/missing input', () => {
    expect(parseFacebookUncategorizedPhotos(null)).toEqual([]);
    expect(parseFacebookUncategorizedPhotos({})).toEqual([]);
  });
});

describe('pickProfilePhoto', () => {
  const album = (
    name: string,
    photos: Array<{ uri: string; creationTimestamp: number }>,
    coverPhotoUri?: string,
  ): FacebookAlbum => ({ name, lastModified: 0, photos, ...(coverPhotoUri ? { coverPhotoUri } : {}) });

  it('picks the newest photo from the profile-pictures album, ignoring other albums', () => {
    const albums = [
      album('Mur', [{ uri: 'm/wall.jpg', creationTimestamp: 9999999999 }]),
      album('Photos de profil', [
        { uri: 'm/old.jpg', creationTimestamp: 1000 },
        { uri: 'm/new.jpg', creationTimestamp: 2000 },
        { uri: 'm/mid.jpg', creationTimestamp: 1500 },
      ]),
    ];
    expect(pickProfilePhoto(albums)).toEqual({ uri: 'm/new.jpg', creationTimestamp: 2000 });
  });

  it('matches English album names case-insensitively', () => {
    const albums = [album('Profile Pictures', [{ uri: 'm/p.jpg', creationTimestamp: 5 }])];
    expect(pickProfilePhoto(albums)?.uri).toBe('m/p.jpg');
  });

  it('falls back to the album cover when no photo carries a timestamp', () => {
    const albums = [
      album(
        'Photos de profil',
        [
          { uri: 'm/a.jpg', creationTimestamp: 0 },
          { uri: 'm/b.jpg', creationTimestamp: 0 },
        ],
        'm/cover.jpg',
      ),
    ];
    expect(pickProfilePhoto(albums)).toEqual({ uri: 'm/cover.jpg', creationTimestamp: 0 });
  });

  it('prefers the newest timestamp over the cover when one exists', () => {
    const albums = [
      album(
        'Photos de profil',
        [
          { uri: 'm/a.jpg', creationTimestamp: 0 },
          { uri: 'm/b.jpg', creationTimestamp: 42 },
        ],
        'm/cover.jpg',
      ),
    ];
    expect(pickProfilePhoto(albums)).toEqual({ uri: 'm/b.jpg', creationTimestamp: 42 });
  });

  it('returns null with no profile-pictures album, or an empty one', () => {
    expect(pickProfilePhoto([])).toBeNull();
    expect(pickProfilePhoto([album('Mur', [{ uri: 'm/x.jpg', creationTimestamp: 1 }])])).toBeNull();
    expect(pickProfilePhoto([album('Photos de profil', [])])).toBeNull();
  });
});
