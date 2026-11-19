/**
 * Images are never stored inside content: every image goes to file storage (R2 or
 * Cloudflare Images) through the media library, and a page refers to it by URL. A base64
 * `data:` image in a post would put the file itself in D1 (capped at 10 GB, and far dearer
 * per GB than R2) and in every page that shows it. The rich-text editor can't produce one
 * any more (pasted images are uploaded), so this is the server-side check for everything
 * else that writes content: the REST API and MCP.
 *
 * Small inline images stay allowed — an icon in an HTML block, a tiny SVG — so the limit is
 * on each image's length, not on `data:` itself.
 */
export const MAX_INLINE_IMAGE_CHARS = 4096

const PREFIX = 'data:image/'

/** Characters that end a data: URI inside JSON, HTML or CSS. */
function endsUri(ch: string): boolean {
  return ch === '"' || ch === '\'' || ch === ')' || ch === '<' || ch === '>' || ch === ' ' || ch === '\n' || ch === '\\'
}

/** The length of the longest `data:image/…` URI anywhere in `text` (0 when there's none). */
export function longestInlineImage(text: string): number {
  let longest = 0
  let from = text.indexOf(PREFIX)
  while (from !== -1) {
    let end = from + PREFIX.length
    while (end < text.length && !endsUri(text[end]!)) end++
    longest = Math.max(longest, end - from)
    from = text.indexOf(PREFIX, end)
  }
  return longest
}

/**
 * A user-facing problem when any of `values` (content JSON, settings, a share-image URL…)
 * embeds an image larger than MAX_INLINE_IMAGE_CHARS; undefined when they're fine.
 */
export function inlineImageProblem(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (value === undefined || value === null) continue
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    if (!text.includes(PREFIX)) continue
    if (longestInlineImage(text) > MAX_INLINE_IMAGE_CHARS) {
      return 'Images can\'t be embedded in the content itself. Upload them to the media library and use them from there.'
    }
  }
  return undefined
}
