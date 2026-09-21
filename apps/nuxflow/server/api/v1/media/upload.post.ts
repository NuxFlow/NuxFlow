import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { getActiveProvider } from '../../../utils/media-providers/index'
import { extractExif } from '../../../utils/exif'
import { extractImageDimensions } from '../../../utils/image-dimensions'
import { sanitizeSvg } from '../../../utils/security'
import { mediaErrorMessage, isHttpError } from '../../../utils/errors'
import { buildAuditLogInsert, batchWithAudit } from '../../../utils/audit'
import { media } from '@nuxflow/db/schema'
import { ulid } from 'ulid'
import { created } from '../../../utils/response'

const MAX_SIZE = 20 * 1024 * 1024

// Media library uploads only ever need to be embedded via <img>/<video>/<audio> or linked
// to directly — no legitimate use case here needs an executable/markup MIME type. SVG is
// the one entry that isn't inherently script-inert (see sanitizeSvg below), everything else
// on this list can't run script when served with its own declared content-type.
const ALLOWED_MIME_PREFIXES = ['image/', 'video/', 'audio/']
const ALLOWED_MIME_EXACT = new Set(['application/pdf'])

function isAllowedMediaMimeType(mime: string): boolean {
  return ALLOWED_MIME_PREFIXES.some(p => mime.startsWith(p)) || ALLOWED_MIME_EXACT.has(mime)
}

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'author')
  const siteId = event.context.siteId as string

  // Reject an oversized body before readFormData() buffers the entire multipart payload
  // into memory — the MAX_SIZE/provider-specific checks below only run after that buffering
  // already happened, which is too late to protect the Worker's own ~128MB isolate memory
  // ceiling (see CLAUDE.md's d1-export.ts postmortem for the same class of failure). A
  // request can lack Content-Length (chunked transfer) and skip this check entirely — the
  // post-buffering size check below still catches those, just without the early-exit benefit.
  const contentLength = Number(getHeader(event, 'content-length') ?? 0)
  if (contentLength > MAX_SIZE) {
    throw createError({ statusCode: 413, message: 'File too large (max 20 MB)' })
  }

  const formData = await readFormData(event)
  const file = formData.get('file') as File | null

  if (!file) throw badRequest('No file provided')
  if (file.size > MAX_SIZE) throw createError({ statusCode: 413, message: 'File too large (max 20 MB)' })
  if (!isAllowedMediaMimeType(file.type)) {
    throw createError({ statusCode: 415, message: `Unsupported file type: ${file.type || 'unknown'}` })
  }

  const fileId = ulid()
  // Allowlist the extension used to build the storage key — file.name is attacker-supplied
  // and otherwise flows unvalidated into a storage identifier passed to provider APIs.
  const rawExt = file.name.split('.').pop() ?? ''
  const ext = /^[a-z0-9]{1,10}$/i.test(rawExt) ? rawExt : 'bin'
  const storageKey = `${siteId}/${fileId}.${ext}`

  // SVG is XML and can carry <script>/event-handler/javascript: vectors that execute when
  // the stored file is opened directly at its own URL with its own image/svg+xml
  // content-type — strip those before it ever reaches storage.
  const uploadFile = file.type === 'image/svg+xml'
    ? new File([sanitizeSvg(await file.text())], file.name, { type: file.type })
    : file

  const provider = await getActiveProvider(event)
  let url: string
  try {
    ;({ url } = await provider.upload(uploadFile, storageKey, siteId))
  } catch (err) {
    // The local fallback provider throws a real H3 error (e.g. 413 over its 512KB cap) —
    // that's an intentional, already-correct status code, not a generic provider failure,
    // so it must pass through unchanged rather than being flattened into a 502.
    if (isHttpError(err)) throw err
    throw createError({ statusCode: 502, message: mediaErrorMessage(err) })
  }

  // Extract EXIF from JPEG/TIFF images — runs after upload so it doesn't block the response path
  let metadata: Record<string, unknown> | undefined
  if (file.type === 'image/jpeg' || file.type === 'image/tiff') {
    try {
      const buf = await file.arrayBuffer()
      const exif = extractExif(buf)
      if (exif) metadata = { exif }
    }
    catch {
      // EXIF extraction is best-effort; never fail the upload
    }
  }

  // Pixel dimensions, read straight from the format's own header (see
  // image-dimensions.ts for why — sharp/ipx cannot run in the Workers runtime, so there's
  // no decode-the-image fallback available). Populates the width/height columns that were
  // previously always null, letting block-rendering code reserve real layout space instead
  // of causing layout shift. Best-effort, same as EXIF above — a format this doesn't
  // recognize (or corrupt bytes) just leaves the columns null, never fails the upload.
  let dimensions: { width: number; height: number } | null = null
  if (file.type === 'image/png' || file.type === 'image/gif' || file.type === 'image/jpeg' || file.type === 'image/webp') {
    try {
      const buf = await file.arrayBuffer()
      dimensions = extractImageDimensions(buf, file.type)
    }
    catch {
      // best-effort; never fail the upload
    }
  }

  const db = useDb(event)
  const mediaInsert = db.insert(media).values({
    id: fileId,
    siteId,
    uploadedBy: userId,
    filename: storageKey,
    originalName: file.name,
    mimeType: file.type,
    size: file.size,
    width: dimensions?.width,
    height: dimensions?.height,
    url,
    storageProvider: provider.name as 'cloudflare' | 'local' | 'r2' | 's3' | 'bunny',
    storageKey,
    ...(metadata ? { metadata } : {}),
  })

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'create',
    resource: 'media',
    resourceId: fileId,
    after: { originalName: file.name, storageKey, mimeType: file.type },
  })
  try {
    await batchWithAudit(db, [mediaInsert], auditInsert)
  } catch (err) {
    // The file is already live in storage with no DB row referencing it — best-effort
    // compensating delete so a D1 write failure doesn't leave a permanently orphaned blob.
    // If the delete itself also fails, that's a single bounded orphan, not a silent
    // unbounded leak, and it's not worth failing differently for than the original error.
    await provider.delete(storageKey).catch(() => {})
    throw err
  }

  return created(event, { id: fileId, url, width: dimensions?.width ?? null, height: dimensions?.height ?? null })
})
