import { z } from 'zod'
import { ulid } from 'ulid'
import { and, eq } from 'drizzle-orm'
import { media } from '@nuxflow/db/schema'
import { requireRole } from '../../../../utils/permissions'
import { useDb } from '../../../../utils/db'
import { writeAuditLog } from '../../../../utils/audit'
import { getActiveProvider } from '../../../../utils/media-providers/index'
import { checkPlanLimit, planLimitMessage } from '../../../../utils/hosting-plans'
import { isSafeUrl, safeFetch } from '../../../../utils/ssrf'
import { sanitizeSvg } from '../../../../utils/sanitize-css-svg'
import { sha256Hex } from '../../../../utils/buffer'
import { errorMessage } from '../../../../utils/errors'

// Small batches: each file is held in memory while it uploads, and the batch runs in
// parallel — a handful of multi-MB images at once stays well inside a Worker's 128 MB.
const bodySchema = z.object({
  importId: z.string().min(1).max(64),
  urls: z.array(z.string().url().max(2048)).min(1).max(5),
})

type MediaResult = { url: string; localUrl: string } | { url: string; error: string }

// WordPress import, step 3: copies a few images from the WordPress site into this site's
// media library and returns old URL → new URL for the browser to rewrite content with.
// Each file's storage key is derived from a hash of its source URL, so a batch retried
// after a dropped connection finds what the first attempt already stored instead of
// uploading a duplicate.
export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const siteId = event.context.siteId as string
  const db = useDb(event)
  const body = await parseBody(event, bodySchema)
  const provider = await getActiveProvider(event)

  const results = await Promise.all(body.urls.map(async (remoteUrl): Promise<MediaResult & { created?: boolean }> => {
    try {
      // SSRF Prevention: Block local or private IP requests
      if (!isSafeUrl(remoteUrl)) return { url: remoteUrl, error: 'Not a public URL' }

      const rawName = decodeURIComponentSafe(remoteUrl.split('/').pop()?.split('?')[0] ?? '') || 'image.jpg'
      const ext = (rawName.includes('.') ? rawName.split('.').pop()! : 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10) || 'jpg'
      const hash = (await sha256Hex(remoteUrl)).slice(0, 24)
      const storageKey = `${siteId}/wp-${hash}.${ext}`

      const existing = await db.query.media.findFirst({
        where: and(eq(media.siteId, siteId), eq(media.storageKey, storageKey)),
        columns: { url: true },
      })
      if (existing) return { url: remoteUrl, localUrl: existing.url }

      const res = await safeFetch(remoteUrl)
      if (!res.ok) return { url: remoteUrl, error: `HTTP ${res.status}` }
      const contentType = (res.headers.get('content-type') ?? 'image/jpeg').split(';')[0]!.trim().toLowerCase()
      // Same rule as a normal upload (media/upload.post.ts): SVG is the one image type that
      // can carry script, so it's sanitized before it's stored.
      const file = contentType === 'image/svg+xml'
        ? new File([sanitizeSvg(await res.text())], rawName, { type: contentType })
        : new File([await res.arrayBuffer()], rawName, { type: contentType })

      const room = await checkPlanLimit(db, siteId, 'storage', file.size)
      if (!room.allowed) return { url: remoteUrl, error: planLimitMessage('storage', room.max ?? 0) }
      const { url: localUrl } = await provider.upload(file, storageKey, siteId)
      await db.insert(media).values({
        id: ulid(),
        siteId,
        uploadedBy: userId,
        filename: storageKey,
        originalName: rawName,
        mimeType: contentType,
        size: file.size,
        url: localUrl,
        storageProvider: provider.name as 'cloudflare' | 'local' | 'r2',
        storageKey,
      })
      return { url: remoteUrl, localUrl, created: true }
    } catch (err) {
      return { url: remoteUrl, error: errorMessage(err, 'Upload failed') }
    }
  }))

  const created = results.filter(r => r.created).length
  if (created > 0) {
    await writeAuditLog(event, userId, {
      action: 'create',
      resource: 'media',
      resourceId: 'wordpress-import',
      after: { importId: body.importId, uploaded: created },
    })
  }

  return { results: results.map(({ created: _created, ...r }) => r) }
})

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}
