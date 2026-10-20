import type { ImageListItem } from './json'

export type GalleryLayout = 'grid' | 'masonry' | 'justified'

/** One file chosen in the host app's media picker (`EditorMediaPicker`). */
export interface PickedMedia {
  url: string
  width?: number
  height?: number
  altText?: string
  caption?: string
}

/** Width/height ratio assumed for an image whose real dimensions aren't known (pasted
 * URL, or media uploaded before dimensions were recorded) — 3:2, the most common camera
 * sensor shape, so an unknown photo lands close to right in a justified row. */
export const FALLBACK_IMAGE_RATIO = 1.5

/** An image's width/height ratio, clamped so one panorama or sliver can't take over a row. */
export function imageRatio(img: Pick<ImageListItem, 'width' | 'height'>): number {
  const { width, height } = img
  if (!width || !height || width <= 0 || height <= 0) return FALLBACK_IMAGE_RATIO
  return Math.min(4, Math.max(0.25, width / height))
}

/** Grid layout's crop-shape option (`'3:2'`) as a width/height number; 1 when invalid. */
export function aspectRatioValue(value: string | undefined): number {
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(value ?? '')
  if (!m) return 1
  const w = Number(m[1])
  const h = Number(m[2])
  return w > 0 && h > 0 ? w / h : 1
}

/** Returns a copy of `list` with the item at `from` moved to `to` (both clamped). */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const out = list.slice()
  if (from < 0 || from >= out.length) return out
  const target = Math.max(0, Math.min(out.length - 1, to))
  const [item] = out.splice(from, 1)
  out.splice(target, 0, item as T)
  return out
}
