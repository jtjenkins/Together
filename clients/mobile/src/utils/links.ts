/** Matches http and https URLs. Stops at whitespace and common delimiters. */
const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g;

/** Image file extensions we render inline. */
const IMAGE_EXT_RE = /\.(jpg|jpeg|png|gif|webp|svg|avif)(\?.*)?$/i;

/**
 * Extract all http/https URLs from a string, in order of appearance.
 */
export function extractUrls(text: string): string[] {
  return [...text.matchAll(URL_REGEX)].map((m) => m[0]);
}

/**
 * Returns true if the URL's path ends with an image file extension.
 * Query strings are ignored when checking the extension.
 */
export function isImageUrl(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    return IMAGE_EXT_RE.test(pathname);
  } catch {
    return false;
  }
}
