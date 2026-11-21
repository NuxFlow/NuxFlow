import type { H3Event } from 'h3'
import { ulid } from 'ulid'
import { media } from '@nuxflow/db/schema'
import { useDb } from './db'
import type { MediaProvider } from './media-providers/index'
import { assertWithinPlan } from './hosting-plans'
import { extractExif } from './exif'
import { extractImageDimensions } from './image-dimensions'
import { sanitizeSvg } from './sanitize-css-svg'
import { mediaErrorMessage, isHttpError } from './errors'
import { buildAuditLogInsert, batchWithAudit } from './audit'
import { httpError } from './response'
import { isDemoMode } from './demo-mode'

// One way a file gets into the media library, shared by the admin upload route
// (media/upload.post.ts) and the MCP `upload_media` tool, so both apply the same type
// allowlist, SVG sanitising, storage plan limit, metadata extraction and audit entry.

export const MAX_MEDIA_UPLOAD_BYTES = 20 * 1024 * 1024

// Media library uploads only ever need to be embedded via <img>/<video>/<audio> or linked
// to directly — no legitimate use case here needs an executable/markup MIME type. SVG is
// the one entry that isn't inherently script-inert (see sanitizeSvg below), everything else
// on this list can't run script when served with its own declared content-type.
const ALLOWED_MIME_PREFIXES = ['image/', 'video/', 'audio/']
const ALLOWED_MIME_EXACT = new Set(['application/pdf'])

function isAllowedMediaMimeType(mime: string): boolean {
  return ALLOWED_MIME_PREFIXES.some(p => mime.startsWith(p)) || ALLOWED_MIME_EXACT.has(mime)
}

/** A declared Content-Type reduced to its bare essence: lowercase, parameters dropped. */
export function bareMimeType(type: string): string {
  return (type.split(';')[0] ?? '').trim().toLowerCase()
}

export interface StoredMedia { id: string; url: string; width: number | null; height: number | null }

/**
 * Validates `file`, uploads it through `provider` (from getActiveProvider(), which the
 * caller resolves first so it can refuse before buffering a body), and records the media
 * row plus its audit entry. Throws H3 errors (413/415/403 plan_limit/502).
 */
export async function storeMediaFile(
  event: H3Event,
  provider: MediaProvider,
  opts: { file: File; userId: string; siteId: string; altText?: string | null },
): Promise<StoredMedia> {
  const { file, userId, siteId } = opts
  if (file.size > MAX_MEDIA_UPLOAD_BYTES) throw httpError({ status: 413, message: 'File too large (max 20 MB)' })
  // Every check below compares against the bare type — the SVG sanitizer used to test
  // `file.type === 'image/svg+xml'` exactly, so `image/svg+xml;x=1` passed the `image/`
  // allowlist, skipped sanitization, and was stored/served as a live SVG.
  const mimeType = bareMimeType(file.type)
  if (!isAllowedMediaMimeType(mimeType)) {
    throw httpError({ status: 415, message: `Unsupported file type: ${mimeType || 'unknown'}` })
  }
  // The public demo takes images only — a PDF or audio file on the operator's domain is
  // the easiest thing to abuse (demo-mode.ts).
  if (isDemoMode(event) && !mimeType.startsWith('image/')) {
    throw httpError({ status: 415, message: 'The live demo accepts images only.' })
  }

  const fileId = ulid()
  // Allowlist the extension used to build the storage key — file.name is attacker-supplied
  // and otherwise flows unvalidated into a storage identifier passed to provider APIs.
  const rawExt = file.name.split('.').pop() ?? ''
  const ext = /^[a-z0-9]{1,10}$/i.test(rawExt) ? rawExt : 'bin'
  const storageKey = `${siteId}/${fileId}.${ext}`

  // SVG is XML and can carry <script>/event-handler/javascript: vectors that execute when
  // the stored file is opened directly at its own URL — strip those before storage.
  // Always re-wrapped with the normalized type, so providers store/serve exactly the
  // type validated above rather than the raw client-declared one.
  const uploadFile = mimeType === 'image/svg+xml'
    ? new File([sanitizeSvg(await file.text())], file.name, { type: mimeType })
    : new File([file], file.name, { type: mimeType })

  await assertWithinPlan(event, 'storage', uploadFile.size)
  let url: string
  try {
    ;({ url } = await provider.upload(uploadFile, storageKey, siteId))
  } catch (err) {
    // A provider that throws a real H3 error chose its status on purpose — pass it through.
    if (isHttpError(err)) throw err
    throw httpError({ status: 502, message: mediaErrorMessage(err) })
  }

  // EXIF from JPEG/TIFF and pixel dimensions from the format's own header (sharp/ipx can't
  // run in Workers, so there's no decode fallback). Both best-effort: never fail an upload.
  let metadata: Record<string, unknown> | undefined
  let dimensions: { width: number; height: number } | null = null
  const needsBytes = mimeType === 'image/jpeg' || mimeType === 'image/tiff' || mimeType === 'image/png' || mimeType === 'image/gif' || mimeType === 'image/webp'
  if (needsBytes) {
    try {
      const buf = await file.arrayBuffer()
      if (mimeType === 'image/jpeg' || mimeType === 'image/tiff') {
        try {
          const exif = extractExif(buf)
          if (exif) metadata = { exif }
        } catch { /* best-effort */ }
      }
      if (mimeType !== 'image/tiff') {
        try { dimensions = extractImageDimensions(buf, mimeType) } catch { /* best-effort */ }
      }
    } catch { /* best-effort */ }
  }

  const db = useDb(event)
  const mediaInsert = db.insert(media).values({
    id: fileId,
    siteId,
    uploadedBy: userId,
    filename: storageKey,
    originalName: file.name,
    mimeType,
    size: file.size,
    width: dimensions?.width,
    height: dimensions?.height,
    url,
    storageProvider: provider.name as 'cloudflare' | 'local' | 'r2',
    storageKey,
    ...(opts.altText ? { altText: opts.altText } : {}),
    ...(metadata ? { metadata } : {}),
  })

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'create',
    resource: 'media',
    resourceId: fileId,
    after: { originalName: file.name, storageKey, mimeType },
  })
  try {
    await batchWithAudit(db, [mediaInsert], auditInsert)
  } catch (err) {
    // The file is already live in storage with no DB row referencing it — best-effort
    // compensating delete so a D1 write failure doesn't leave an orphaned blob.
    await provider.delete(storageKey).catch(() => {})
    throw err
  }

  return { id: fileId, url, width: dimensions?.width ?? null, height: dimensions?.height ?? null }
}
