import type { H3Event } from 'h3'
import { and, eq, inArray } from 'drizzle-orm'
import { media } from '@nuxflow/db/schema'
import { useDb } from './db'
import { getCfBindings } from './cf-env'
import { workerMediaKey } from './media-url'
import { isSafeUrl, safeFetch } from './ssrf'
import { findPublishedPage, parseLocalePath } from './public-page'
import { checkContentAccess } from './content-access'
import { base64ToBytes } from '../../shared/lib/base64'

/**
 * Downloads for a Gallery block that has "Allow downloads" switched on (client galleries):
 * the whole gallery as a zip, or one photo. Anyone who can see the page can download —
 * the same gate as the page itself (password, members, tier). Only files from the site's
 * own media library (or inline data: images) are served; an external URL pasted into a
 * gallery is left out rather than fetched, so this can't be used to make the Worker fetch
 * arbitrary addresses.
 */

/** fflate writes no Zip64, so an archive must stay under 4 GiB; 2 GiB leaves headroom. */
export const MAX_GALLERY_ZIP_BYTES = 2 * 1024 * 1024 * 1024
export const MAX_GALLERY_ZIP_FILES = 1000

interface CanvasBlock { id?: unknown; type?: unknown; props?: Record<string, unknown>; children?: Record<string, unknown> }

/** Finds a Gallery block by id anywhere in a Canvas document (including inside Columns/Container slots). */
export function findGalleryBlock(content: unknown, blockId: string): CanvasBlock | null {
  const blocks = (content as { blocks?: unknown } | null)?.blocks
  const walk = (list: unknown): CanvasBlock | null => {
    if (!Array.isArray(list)) return null
    for (const b of list as CanvasBlock[]) {
      if (!b || typeof b !== 'object') continue
      if (b.id === blockId && b.type === 'canvas-gallery') return b
      for (const kids of Object.values(b.children ?? {})) {
        const found = walk(kids)
        if (found) return found
      }
    }
    return null
  }
  return walk(blocks)
}

/** The gallery's image URLs, in gallery order. */
export function galleryImageUrls(block: CanvasBlock): string[] {
  let list: unknown
  try {
    list = JSON.parse(String(block.props?.images ?? '[]'))
  }
  catch {
    return []
  }
  return Array.isArray(list)
    ? list.flatMap(i => (i && typeof i === 'object' && typeof (i as { url?: unknown }).url === 'string' ? [(i as { url: string }).url] : []))
    : []
}

/** Makes every name unique ("DSC_1.jpg", "DSC_1 (2).jpg") and safe as a single zip path segment. */
export function uniqueFileNames(names: string[]): string[] {
  const used = new Set<string>()
  return names.map((raw) => {
    const clean = [...raw].filter(ch => ch.charCodeAt(0) >= 32).join('')
      .replace(/[/\\]/g, '_').replace(/^\.+/, '').trim() || 'photo'
    const dot = clean.lastIndexOf('.')
    const [stem, ext] = dot > 0 ? [clean.slice(0, dot), clean.slice(dot)] : [clean, '']
    let candidate = clean
    for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${stem} (${n})${ext}`
    used.add(candidate.toLowerCase())
    return candidate
  })
}

const MIME_EXT: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif', 'image/svg+xml': '.svg' }

export interface GalleryFile {
  url: string
  name: string
  mimeType: string
  size: number | null
  storageProvider: string | null
  storageKey: string | null
}

/**
 * Resolves and authorizes a download: the published page at `path`, its gallery block
 * `blockId` (which must allow downloads), and the files it may serve. Throws 404 for
 * anything a visitor may not download — including a page they can't see, so a gated
 * page's existence isn't confirmed.
 */
export async function prepareGalleryDownload(event: H3Event, siteId: string, path: string, blockId: string) {
  const db = useDb(event)
  const slugPath = path.replace(/^\/+|\/+$/g, '') || 'home'
  const { locale, slug } = await parseLocalePath(db, siteId, slugPath)
  const page = await findPublishedPage(db, siteId, slug || 'home', locale)
  if (!page) throw notFound()

  const gate = await checkContentAccess(event, { id: page.id, sourceItemId: page.sourceItemId, visibility: page.visibility, settings: page.settings as Record<string, unknown> | null }, siteId)
  if (gate?.blocked) throw notFound()

  const block = findGalleryBlock(page.content, blockId)
  if (!block || block.props?.allowDownload !== true) throw notFound()

  const urls = galleryImageUrls(block)
  const linkUrls = [...new Set(urls.filter(u => !u.startsWith('data:')))]
  const rows = linkUrls.length
    ? await db.query.media.findMany({
        where: and(eq(media.siteId, siteId), inArray(media.url, linkUrls)),
        columns: { url: true, originalName: true, mimeType: true, size: true, storageProvider: true, storageKey: true },
      })
    : []
  const byUrl = new Map(rows.map(r => [r.url, r]))

  const files: Array<Omit<GalleryFile, 'name'> & { baseName: string }> = []
  urls.forEach((url, i) => {
    if (url.startsWith('data:')) {
      const mimeType = /^data:([^;,]+)/.exec(url)?.[1] ?? 'application/octet-stream'
      files.push({ url, baseName: `photo-${i + 1}${MIME_EXT[mimeType] ?? ''}`, mimeType, size: null, storageProvider: 'local', storageKey: null })
      return
    }
    const row = byUrl.get(url)
    if (!row) return // not in this site's library — never fetched
    files.push({ url, baseName: row.originalName, mimeType: row.mimeType, size: row.size, storageProvider: row.storageProvider, storageKey: row.storageKey })
  })

  const names = uniqueFileNames(files.map(f => f.baseName))
  return {
    page,
    files: files.map(({ baseName: _baseName, ...f }, i) => ({ ...f, name: names[i]! })) as GalleryFile[],
    archiveName: `${(page.slug === 'home' ? 'gallery' : page.slug).replace(/[^a-z0-9-]+/gi, '-')}.zip`,
  }
}

function bytesStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close() } })
}

/** Opens one gallery file for reading; null when it can't be read (left out of the zip). */
export async function openGalleryFile(event: H3Event, siteId: string, file: GalleryFile): Promise<ReadableStream<Uint8Array> | null> {
  if (file.url.startsWith('data:')) {
    const comma = file.url.indexOf(',')
    if (comma < 0 || !file.url.slice(0, comma).endsWith(';base64')) return null
    try {
      return bytesStream(base64ToBytes(file.url.slice(comma + 1)))
    }
    catch {
      return null
    }
  }
  const { r2 } = getCfBindings(event)
  // Worker-served R2 URLs, and R2 rows generally, are read from the binding (never another
  // site's key) rather than over the network.
  const key = workerMediaKey(file.url, siteId)
    ?? (file.storageProvider === 'r2' && file.storageKey?.startsWith(`${siteId}/`) ? file.storageKey : null)
  if (key && r2) {
    const object = await r2.get(key)
    if (object?.body) return object.body as ReadableStream<Uint8Array>
  }
  if (!isSafeUrl(file.url)) return null
  try {
    const res = await safeFetch(file.url)
    return res.ok && res.body ? res.body : null
  }
  catch {
    return null
  }
}
