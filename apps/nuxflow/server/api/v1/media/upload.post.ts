import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { getActiveProvider } from '../../../utils/media-providers/index'
import { media } from '@nuxflow/db/schema'
import { ulid } from 'ulid'

const MAX_SIZE = 20 * 1024 * 1024

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'author')
  const siteId = event.context.siteId as string
  const formData = await readFormData(event)
  const file = formData.get('file') as File | null

  if (!file) throw createError({ statusCode: 400, message: 'No file provided' })
  if (file.size > MAX_SIZE) throw createError({ statusCode: 413, message: 'File too large (max 20 MB)' })

  const fileId = ulid()
  const ext = file.name.split('.').pop() ?? ''
  const storageKey = `${siteId}/${fileId}.${ext}`

  const provider = getActiveProvider()
  const { url } = await provider.upload(file, storageKey, siteId)

  const db = useDb(event)
  await db.insert(media).values({
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
  })

  setResponseStatus(event, 201)
  return { id: fileId, url }
})
