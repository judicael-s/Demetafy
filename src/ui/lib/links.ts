/**
 * Permalink helpers shared by the Saved view and the DM thread view. A saved post
 * and a post shared into a DM are the same shape — an Instagram/Facebook permalink
 * — so the type/shortcode/"is this downloadable?" logic lives here, used by both.
 */

/** Human label for a permalink (Reel / Post / IGTV, else generic Link). */
export function linkType(url: string): string {
  if (/\/reels?\//.test(url)) return "Reel";
  if (/\/p\//.test(url)) return "Post";
  if (/\/tv\//.test(url)) return "IGTV";
  return "Link";
}

/** Short code for display: the permalink slug, else a trimmed host+path. */
export function shortCode(url: string): string {
  const m = /\/(?:p|reel|reels|tv)\/([^/?#]+)/.exec(url);
  return m?.[1] ?? url.replace(/^https?:\/\//, "").slice(0, 24);
}

// Instagram post/reel/tv permalink (optionally with a leading username segment,
// as some DM share links carry one); Facebook video/reel + fb.watch.
const IG_PERMALINK = /instagram\.com\/(?:[^/?#]+\/)?(?:p|reels?|tv)\/[^/?#]+/i;
const FB_VIDEO = /facebook\.com\/(?:[^/?#]+\/)?(?:videos|reel)\/|fb\.watch\//i;

/**
 * True when a shared link points at a single downloadable post/reel that yt-dlp
 * can fetch. Conservative: profile links, story links, and arbitrary external
 * URLs shared in chat return false (no single media to download).
 */
export function isDownloadableShare(link: string | undefined | null): boolean {
  if (!link) return false;
  return IG_PERMALINK.test(link) || FB_VIDEO.test(link);
}
