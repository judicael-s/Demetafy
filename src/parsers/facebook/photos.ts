import { fixMojibake } from '../instagram/encoding.js';

export interface FacebookPhoto {
  /** Archive-relative path, resolved across parts at browse time. */
  uri: string;
  /** Seconds since epoch; 0 if absent. */
  creationTimestamp: number;
  title?: string;
  description?: string;
}

/** A Facebook photo album, parsed from `posts/album/<n>.json`. */
export interface FacebookAlbum {
  name: string;
  description?: string;
  /** Seconds since epoch; 0 if absent. */
  lastModified: number;
  coverPhotoUri?: string;
  photos: FacebookPhoto[];
}

interface RawPhoto {
  uri?: string;
  creation_timestamp?: number;
  title?: string;
  description?: string;
}
interface RawAlbum {
  name?: string;
  description?: string;
  last_modified_timestamp?: number;
  cover_photo?: RawPhoto;
  photos?: RawPhoto[];
}
interface RawUncategorized {
  other_photos_v2?: RawPhoto[];
}

function parsePhoto(raw: RawPhoto): FacebookPhoto | null {
  if (typeof raw.uri !== 'string') return null;
  const photo: FacebookPhoto = { uri: raw.uri, creationTimestamp: raw.creation_timestamp ?? 0 };
  if (raw.title) photo.title = fixMojibake(raw.title);
  if (raw.description) photo.description = fixMojibake(raw.description);
  return photo;
}

/** Parse one `posts/album/<n>.json` album file. */
export function parseFacebookAlbum(json: unknown): FacebookAlbum {
  const album: FacebookAlbum = { name: '', lastModified: 0, photos: [] };
  if (!json || typeof json !== 'object' || Array.isArray(json)) return album;
  const raw = json as RawAlbum;

  album.name = fixMojibake(raw.name ?? '');
  if (raw.description) album.description = fixMojibake(raw.description);
  album.lastModified = raw.last_modified_timestamp ?? 0;
  if (typeof raw.cover_photo?.uri === 'string') album.coverPhotoUri = raw.cover_photo.uri;

  for (const p of raw.photos ?? []) {
    const photo = parsePhoto(p);
    if (photo) album.photos.push(photo);
  }
  return album;
}

/** Parse `posts/your_uncategorized_photos.json` (root key `other_photos_v2`). */
export function parseFacebookUncategorizedPhotos(json: unknown): FacebookPhoto[] {
  if (!json || typeof json !== 'object') return [];
  const out: FacebookPhoto[] = [];
  for (const p of (json as RawUncategorized).other_photos_v2 ?? []) {
    const photo = parsePhoto(p);
    if (photo) out.push(photo);
  }
  return out;
}

// Names Meta gives the dedicated profile-pictures album, per locale. Alex' archive
// is French ("Photos de profil"); the English forms keep this working for a public
// release. Compared case-insensitively against the (mojibake-fixed) album name.
const PROFILE_ALBUM_NAMES = ['photos de profil', 'profile pictures', 'profile photos'];

/**
 * The owner's current profile picture, taken from the profile-pictures album.
 * Newest by `creationTimestamp` = the most recently set picture. When the album
 * carries no usable timestamps, the album cover is the current picture. Returns
 * null if the archive has no recognizable profile-pictures album (or it's empty).
 */
export function pickProfilePhoto(albums: FacebookAlbum[]): FacebookPhoto | null {
  const album = albums.find((a) => PROFILE_ALBUM_NAMES.includes(a.name.trim().toLowerCase()));
  if (!album) return null;

  let newest: FacebookPhoto | null = null;
  for (const p of album.photos) {
    if (!newest || p.creationTimestamp > newest.creationTimestamp) newest = p;
  }
  if (!newest) return null;
  if (newest.creationTimestamp === 0 && album.coverPhotoUri) {
    return { uri: album.coverPhotoUri, creationTimestamp: 0 };
  }
  return newest;
}
