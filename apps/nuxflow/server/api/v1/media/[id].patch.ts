import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../utils/audit'
import { getMediaByIdOrThrow } from '../../../utils/resource-queries'
import { media, mediaFolders } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { scopedById } from '../../../utils/db-helpers'

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

  const existing = await getMediaByIdOrThrow(db, siteId, id)

  if (body.folderId) {
    const folder = await db.query.mediaFolders.findFirst({
      where: and(eq(mediaFolders.id, body.folderId), eq(mediaFolders.siteId, siteId)),
      columns: { id: true },
    })
    if (!folder) throw notFound('Folder not found')
  }

  const mediaUpdate = db.update(media).set(body).where(scopedById(media.id, id, media.siteId, siteId))

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'update',
    resource: 'media',
    resourceId: id,
    before: { altText: existing.altText, caption: existing.caption, folderId: existing.folderId, focalX: existing.focalX, focalY: existing.focalY },
    after: body,
  })
  await batchWithAudit(db, [mediaUpdate], auditInsert)

  return { id }
})
