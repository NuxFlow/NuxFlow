import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { writeAuditLog } from '../../../utils/audit'
import { media, mediaFolders } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

const bodySchema = z.object({
  altText: z.string().max(500).nullable().optional(),
  caption: z.string().max(1000).nullable().optional(),
  folderId: z.string().nullable().optional(),
  focalX: z.number().int().min(0).max(100).nullable().optional(),
  focalY: z.number().int().min(0).max(100).nullable().optional(),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'author')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!
  const body = await parseBody(event, bodySchema)

  const existing = await db.query.media.findFirst({
    where: and(eq(media.id, id), eq(media.siteId, siteId)),
  })
  if (!existing) throw notFound('Not found')

  if (body.folderId) {
    const folder = await db.query.mediaFolders.findFirst({
      where: and(eq(mediaFolders.id, body.folderId), eq(mediaFolders.siteId, siteId)),
      columns: { id: true },
    })
    if (!folder) throw notFound('Folder not found')
  }

  await db.update(media).set(body).where(and(eq(media.id, id), eq(media.siteId, siteId)))

  void writeAuditLog(event, userId, {
    action: 'update',
    resource: 'media',
    resourceId: id,
    before: { altText: existing.altText, caption: existing.caption, folderId: existing.folderId, focalX: existing.focalX, focalY: existing.focalY },
    after: body,
  })

  return { id }
})
