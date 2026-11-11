import { and, eq, inArray } from 'drizzle-orm'
import { media } from '@nuxflow/db/schema'
import type { Db } from './db'
import type { ExifData } from './exif'

/**
 * Camera details for Gallery blocks with "Show camera details" on. EXIF is read once, at
 * upload (exif.ts → media.metadata.exif); a gallery only stores each photo's URL, so the
 * public page API looks the photos up in this site's library and adds a `camera` line to
 * each image. Never stored — the page's content stays as saved.
 */

interface BlockLike {
  type?: string
  props?: Record<string, unknown>
  children?: Record<string, BlockLike[]>
}

/** "Canon EOS R5 · 85 mm · f/1.8 · 1/250 s · ISO 100"; '' when there's nothing to say. */
export function cameraLine(exif: ExifData | null | undefined): string {
  if (!exif) return ''
  const make = exif.make?.trim() ?? ''
  const model = exif.model?.trim() ?? ''
  // Most cameras repeat the maker in the model ("Canon" + "Canon EOS R5").
  const body = model && make && model.toLowerCase().startsWith(make.toLowerCase().split(' ')[0]!) ? model : [make, model].filter(Boolean).join(' ')
  const parts = [
    body,
    exif.focalLength ? `${exif.focalLength} mm` : '',
    exif.fNumber ? `f/${exif.fNumber}` : '',
    exif.exposureTime ? `${exif.exposureTime} s` : '',
    exif.iso ? `ISO ${exif.iso}` : '',
  ].filter(Boolean)
  return parts.join(' · ')
}

function galleriesIn(blocks: unknown, out: BlockLike[] = []): BlockLike[] {
  if (!Array.isArray(blocks)) return out
  for (const b of blocks as BlockLike[]) {
    if (!b || typeof b !== 'object') continue
    if (b.type === 'canvas-gallery' && b.props?.showCameraDetails === true) out.push(b)
    for (const slot of Object.values(b.children ?? {})) galleriesIn(slot, out)
  }
  return out
}

function imagesOf(block: BlockLike): Array<{ url?: unknown } & Record<string, unknown>> {
  try {
    const list = JSON.parse(String(block.props?.images ?? '[]'))
    return Array.isArray(list) ? list.filter(i => i && typeof i === 'object') : []
  } catch {
    return []
  }
}

/** Returns new content with camera details on the photos of opted-in galleries. */
export async function addGalleryCameraDetails<T>(db: Db, siteId: string, content: T): Promise<T> {
  const c = content as { type?: string; blocks?: unknown } | null
  if (!c || c.type !== 'canvas') return content
  if (!galleriesIn(c.blocks).length) return content

  const copy = structuredClone(content) as { blocks?: unknown }
  const galleries = galleriesIn(copy.blocks)
  const urls = [...new Set(galleries.flatMap(g => imagesOf(g).map(i => i.url)).filter((u): u is string => typeof u === 'string' && !u.startsWith('data:')))]
  if (!urls.length) return content

  const lines = new Map<string, string>()
  for (let i = 0; i < urls.length; i += 90) {
    const rows = await db.select({ url: media.url, metadata: media.metadata }).from(media)
      .where(and(eq(media.siteId, siteId), inArray(media.url, urls.slice(i, i + 90))))
    for (const row of rows) {
      const line = cameraLine((row.metadata as { exif?: ExifData } | null)?.exif)
      if (line) lines.set(row.url, line)
    }
  }
  if (!lines.size) return content

  for (const g of galleries) {
    const images = imagesOf(g).map(img => (typeof img.url === 'string' && lines.has(img.url) ? { ...img, camera: lines.get(img.url) } : img))
    g.props = { ...g.props, images: JSON.stringify(images) }
  }
  return copy as T
}
