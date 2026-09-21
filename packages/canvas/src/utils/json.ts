/**
 * Parses `json` and returns the result, or `fallback` when `json` is falsy or parsing
 * throws. Centralizes the "JSON.parse a stored prop string, swallow errors, fall back
 * to a default" pattern that used to be reimplemented independently across block
 * components and the editor's field renderer — each one hand-rolling its own
 * try/catch around a block prop that's always stored as an opaque JSON string
 * (images, list fields, footer link columns, etc.).
 */
export function safeJsonParse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback
  try {
    return JSON.parse(json) as T
  }
  catch {
    return fallback
  }
}

export interface ImageListItem {
  url: string
  alt?: string
}

/**
 * Parses a block's `images`-type prop (a JSON string of `{url, alt}` objects) into an
 * array, dropping anything not shaped like a real image entry. Matches the shape
 * filter CanvasBlockGallery.vue and CanvasBlockCarousel.vue each applied inline
 * before this was extracted — unlike `safeJsonParse` alone, callers that need the
 * un-filtered array (e.g. FieldRenderer's editor-side preview) should use
 * `safeJsonParse` directly instead of this.
 */
export function parseImageList(json: string | null | undefined): ImageListItem[] {
  const arr = safeJsonParse<unknown>(json, [])
  if (!Array.isArray(arr)) return []
  return arr.filter((x): x is ImageListItem =>
    typeof x === 'object' && x !== null && typeof (x as ImageListItem).url === 'string',
  )
}
