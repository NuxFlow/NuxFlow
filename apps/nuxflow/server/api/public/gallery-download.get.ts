import { sendStream } from 'h3'
import { Zip, ZipPassThrough } from 'fflate'
import { z } from 'zod'
import { rateLimit } from '../../utils/rate-limit'
import {
  MAX_GALLERY_ZIP_BYTES,
  MAX_GALLERY_ZIP_FILES,
  openGalleryFile,
  prepareGalleryDownload,
} from '../../utils/gallery-download'

// Download a Gallery block's photos ("Allow downloads" on): the whole gallery as a zip, or
// one photo with ?index=. Access, block lookup and the library-only rule live in
// utils/gallery-download.ts.
const querySchema = z.object({
  path: z.string().max(500).default(''),
  block: z.string().min(1).max(100),
  index: z.coerce.number().int().min(0).optional(),
})

function contentDisposition(name: string) {
  const ascii = name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

export default defineEventHandler(async (event) => {
  const siteId = event.context.siteId as string
  const query = parseQuery(event, querySchema)
  const single = query.index !== undefined

  await rateLimit(event, single
    ? { limit: 300, windowMs: 60 * 60_000, keyPrefix: 'gallery-photo' }
    : { limit: 20, windowMs: 60 * 60_000, keyPrefix: 'gallery-zip' })

  const { files, archiveName } = await prepareGalleryDownload(event, siteId, query.path, query.block)

  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'X-Robots-Tag', 'noindex')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')

  // ── One photo ───────────────────────────────────────────────────────────────
  if (single) {
    const file = files[query.index!]
    const body = file ? await openGalleryFile(event, siteId, file) : null
    if (!file || !body) throw notFound('Not found')
    setHeader(event, 'Content-Type', file.mimeType || 'application/octet-stream')
    setHeader(event, 'Content-Disposition', contentDisposition(file.name))
    if (file.size) setHeader(event, 'Content-Length', file.size)
    return sendStream(event, body)
  }

  // ── Whole gallery as a zip ──────────────────────────────────────────────────
  if (!files.length) throw notFound('Not found')
  if (files.length > MAX_GALLERY_ZIP_FILES) {
    throw createError({ statusCode: 413, message: `Galleries over ${MAX_GALLERY_ZIP_FILES} photos can't be downloaded in one go.` })
  }
  const declared = files.reduce((sum, f) => sum + (f.size ?? 0), 0)
  if (declared > MAX_GALLERY_ZIP_BYTES) {
    throw createError({ statusCode: 413, message: 'This gallery is too large to download in one go (over 2 GB).' })
  }

  setHeader(event, 'Content-Type', 'application/zip')
  setHeader(event, 'Content-Disposition', contentDisposition(archiveName))

  // Streamed one file at a time, stored (photos are already compressed) — never held in
  // memory, the same approach as the site backup (api/v1/backup.get.ts).
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
  const writer = writable.getWriter()
  let pending: Promise<void> = Promise.resolve()
  let zipError: Error | null = null
  const zip = new Zip((err, chunk) => {
    if (err) {
      zipError = err
      return
    }
    pending = pending.then(() => writer.write(chunk))
  })

  void (async () => {
    try {
      let total = 0
      for (const file of files) {
        const body = await openGalleryFile(event, siteId, file)
        if (!body) continue
        const entry = new ZipPassThrough(file.name)
        zip.add(entry)
        const reader = body.getReader()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          total += value.byteLength
          // The size column is what the pre-check trusted; stop if the files disagree.
          if (total > MAX_GALLERY_ZIP_BYTES) throw new Error('Gallery exceeds the download size limit.')
          entry.push(value)
          await pending
          if (zipError) throw zipError
        }
        entry.push(new Uint8Array(0), true)
        await pending
      }
      zip.end()
      await pending
      if (zipError) throw zipError
      await writer.close()
    }
    catch (err) {
      // Headers are already sent: abort so the browser shows a failed download instead of a
      // truncated zip that looks complete.
      console.error('[gallery-download] Streaming the zip failed:', err)
      await writer.abort(err).catch(() => {})
    }
  })()

  return sendStream(event, readable)
})
