export type Orientation = "portrait" | "landscape";

/**
 * Decide a phone-frame orientation from a media item's intrinsic dimensions.
 * Unknown / not-yet-loaded dimensions (zeros) resolve to portrait: most Instagram
 * and Facebook video (reels, stories) is portrait, so defaulting that way avoids a
 * visible frame flip once `loadedmetadata` reports the real size.
 */
export function orientationOf(width: number, height: number): Orientation {
  return width > 0 && height > 0 && width > height ? "landscape" : "portrait";
}
