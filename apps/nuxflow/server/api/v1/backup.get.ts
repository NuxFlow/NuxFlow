import { sendStream } from 'h3'
import { z } from 'zod'
import { Zip, ZipDeflate, ZipPassThrough } from 'fflate'
import { requireRole } from '../../utils/permissions'
import { buildBackup } from '../../utils/backup'
import { isSafeUrl, safeFetch } from '../../utils/ssrf'
import { writeAuditLog } from '../../utils/audit'
import { getCfBindings } from '../../utils/cf-env'
import { workerMediaKey } from '../../utils/media-url'
import { requireSiteId } from '../../utils/site-context'
import { utcDay } from '../../utils/utc-day'
import { useDb } from '../../utils/db'
import { productVariants } from '@nuxflow/db/schema'
import { and, eq, isNotNull } from 'drizzle-orm'

const querySchema = z.object({
  // '1' = include passwords and API keys (decrypted). Off unless asked for.
  includeSecrets: z.enum(['0', '1']).optional(),
})

// Matches restore.post.ts's upload limit — a bigger backup couldn't be restored.
const MAX_RAW_MEDIA_BYTES = 100 * 1024 * 1024

// The zip is streamed to the browser as it's built, one media file at a time, rather than
// assembled in memory: holding every file plus the finished zip (up to ~200 MB) is well
// past a Worker's 128 MB memory limit. Media files are stored, not compressed — images,
// video and PDFs are already compressed, so deflating them only burned CPU; backup.json
// (very compressible) is the one entry that's deflated.
export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const siteId = requireSiteId(event)

  const { includeSecrets } = await parseQuery(event, querySchema)
  const backup = await buildBackup(event, siteId, { includeSecrets: includeSecrets === '1' })

  // data: URIs are already embedded in backup.json as text; everything else is bundled.
  const bundled = backup.media.filter(item => !item.url.startsWith('data:'))
  // Digital products' downloads, from the private part of the bucket. The key never goes in
  // backup.json (like media's storage key); the variant's old id names its place in the zip.
  const downloadRows = await useDb(event).select({ id: productVariants.id, fileKey: productVariants.fileKey })
    .from(productVariants)
    .where(and(eq(productVariants.siteId, siteId), isNotNull(productVariants.fileKey)))
  const downloadKeyById = new Map(downloadRows.map(r => [r.id, r.fileKey!]))
  const downloads = backup.content.flatMap(item => item.product?.variants ?? [])
    .filter(v => v.fileName && downloadKeyById.has(v.id))
  const declaredBytes = bundled.reduce((sum, item) => sum + (item.size || 0), 0)
    + downloads.reduce((sum, v) => sum + (v.fileSize || 0), 0)
  if (declaredBytes > MAX_RAW_MEDIA_BYTES) {
    throw httpError({
      status: 413,
      message: 'Backup exceeds 100 MB of media and downloads. Remove unused media files and try again.',
    })
  }

  // With includeSecrets the export holds every site setting decrypted to plaintext (API
  // keys, OAuth secrets, etc. — see buildBackup) — worth its own audit trail entry distinct
  // from ordinary reads, since downloading one is effectively exporting live credentials.
  await writeAuditLog(event, userId, {
    action: 'export', resource: 'site', resourceId: siteId,
    after: { includeSecrets: includeSecrets === '1' },
  })

  const filename = `nuxflow-backup-${utcDay()}.zip`
  setHeader(event, 'Content-Type', 'application/zip')
  setHeader(event, 'Content-Disposition', `attachment; filename="${filename}"`)

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
  const writer = writable.getWriter()

  // fflate's Zip emits output synchronously; writes are chained so they reach the stream in
  // order, and awaiting the chain after each input chunk keeps memory bounded to roughly one
  // chunk (backpressure from the client's download speed).
  let pending: Promise<void> = Promise.resolve()
  let zipError: Error | null = null
  const zip = new Zip((err, chunk) => {
    if (err) {
      zipError = err
      return
    }
    pending = pending.then(() => writer.write(chunk))
  })

  async function addStream(path: string, body: ReadableStream<Uint8Array>, limit: { bytes: number }) {
    const entry = new ZipPassThrough(path)
    zip.add(entry)
    const reader = body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      limit.bytes += value.byteLength
      // The size column is what the pre-check above trusted; stop if the files disagree.
      if (limit.bytes > MAX_RAW_MEDIA_BYTES) throw new Error('Backup exceeds 100 MB of media.')
      entry.push(value)
      await pending
      if (zipError) throw zipError
    }
    entry.push(new Uint8Array(0), true)
    await pending
  }

  // Opens a media file for reading, or returns null to leave it out (zipPath stays null).
  async function openMedia(url: string): Promise<ReadableStream<Uint8Array> | null> {
    // Worker-served R2 (no public bucket URL): site-relative, read from the binding. These
    // used to fail the absolute-URL safety check and were silently left out of the backup.
    const key = workerMediaKey(url, siteId)
    if (key) {
      const { r2 } = getCfBindings(event)
      const object = r2 ? await r2.get(key) : null
      return object?.body ?? null
    }
    // SSRF Prevention: Block local or private IP requests
    if (!isSafeUrl(url)) return null
    try {
      const res = await safeFetch(url)
      return res.ok && res.body ? res.body : null
    } catch {
      return null // Network error fetching this file — skip it
    }
  }

  void (async () => {
    try {
      const limit = { bytes: 0 }
      for (const item of bundled) {
        const body = await openMedia(item.url)
        if (!body) continue
        const ext = item.originalName.split('.').pop() ?? 'bin'
        item.zipPath = `images/${item.id}.${ext}`
        await addStream(item.zipPath, body, limit)
      }

      const { r2 } = getCfBindings(event)
      for (const variant of downloads) {
        const key = downloadKeyById.get(variant.id)!
        // Only this site's own private shop files.
        if (!r2 || !key.startsWith(`_private/${siteId}/shop/`)) continue
        const object = await r2.get(key)
        if (!object?.body) continue
        const safeName = variant.fileName!.replace(/[^\w.-]+/g, '-').slice(-100) || 'file'
        variant.fileZipPath = `downloads/${variant.id}/${safeName}`
        await addStream(variant.fileZipPath, object.body, limit)
      }

      // Last, so it records the zipPath of every file that made it in.
      const json = new ZipDeflate('backup.json', { level: 6 })
      zip.add(json)
      json.push(new TextEncoder().encode(JSON.stringify(backup, null, 2)), true)
      zip.end()
      await pending
      if (zipError) throw zipError
      await writer.close()
    } catch (err) {
      // Headers are already sent, so this can't become an HTTP error. Aborting the stream
      // fails the download in the browser instead of leaving a truncated zip that looks
      // complete.
      console.error('[backup] Streaming the backup failed:', err)
      await writer.abort(err).catch(() => {})
    }
  })()

  return sendStream(event, readable)
})
