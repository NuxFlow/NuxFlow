import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { getActiveProvider } from '../../../utils/media-providers/index'
import { extractExif } from '../../../utils/exif'
import { buildAuditLogInsert, batchWithAudit } from '../../../utils/audit'
import { media } from '@nuxflow/db/schema'
import { ulid } from 'ulid'
import { created } from '../../../utils/response'

const MAX_SIZE = 20 * 1024 * 1024

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'author')
  const siteId = event.context.siteId as string
  const formData = await readFormData(event)
  const file = formData.get('file') as File | null

  if (!file) throw badRequest('No file provided')
  if (file.size > MAX_SIZE) throw createError({ statusCode: 413, message: 'File too large (max 20 MB)' })

  const fileId = ulid()
  const ext = file.name.split('.').pop() ?? ''
  const storageKey = `${siteId}/${fileId}.${ext}`

  const provider = await getActiveProvider(event)
  const { url } = await provider.upload(file, storageKey, siteId)

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

  const db = useDb(event)
  const mediaInsert = db.insert(media).values({
    id: fileId,
    siteId,
    uploadedBy: userId,
    filename: storageKey,
    originalName: file.name,
    mimeType: file.type,
    size: file.size,
    url,
    storageProvider: provider.name as 'cloudflare' | 'local' | 'r2',
    storageKey,
    ...(metadata ? { metadata } : {}),
  })

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'create',
    resource: 'media',
    resourceId: fileId,
    after: { originalName: file.name, storageKey, mimeType: file.type },
  })
  await batchWithAudit(db, [mediaInsert], auditInsert)

  return created(event, { id: fileId, url })
})
