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
  /** Intrinsic pixel dimensions, when known — populated by the media picker from the
   * `media` table's own width/height (see server/utils/image-dimensions.ts); absent for
   * a manually-pasted URL or for media uploaded before that extraction existed. Lets
   * image-rendering code reserve real layout space instead of causing layout shift. */
  width?: number
  height?: number
}

/**
 * Parses a block's `images`-type prop (a JSON string of `{url, alt, width?, height?}`
 * objects) into an array, dropping anything not shaped like a real image entry. Matches
 * the shape filter CanvasBlockGallery.vue and CanvasBlockCarousel.vue each applied inline
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

/** Stored shape of an `'image'`-type field going forward — see normalizeImageValue(). */
export interface ImageFieldValue {
  url: string
  width?: number
  height?: number
}

/**
 * Normalizes an `'image'`-type field's stored value, which can be either shape:
 *  - a bare URL string — every block prop stored before this type existed, since the
 *    field used to store nothing but the URL
 *  - `{url, width?, height?}` — written by the media picker (see FieldRenderer.vue's
 *    'image' branch) from here on, carrying real dimensions when the picker has them
 *
 * Centralizing this means every consumer (FieldRenderer's own preview, CanvasBlockImage,
 * CanvasBlockTestimonial) reads one shape regardless of which era a given piece of stored
 * content came from — no migration needed since Canvas block props are opaque JSON.
 */
export function normalizeImageValue(value: unknown): ImageFieldValue {
  if (typeof value === 'string') return { url: value }
  if (value && typeof value === 'object' && typeof (value as ImageFieldValue).url === 'string') {
    const v = value as ImageFieldValue
    return { url: v.url, width: v.width, height: v.height }
  }
  return { url: '' }
}
