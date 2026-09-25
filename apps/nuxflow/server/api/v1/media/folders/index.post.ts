import { z } from 'zod'
import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../../utils/audit'
import { created } from '../../../../utils/response'
import { mediaFolders } from '@nuxflow/db/schema'
import { ulid } from 'ulid'

const bodySchema = z.object({
  // trim() must come first — Zod runs checks in order, so min(1) before trim() lets a
  // whitespace-only name through and saves it as ''.
  name: z.string().trim().min(1).max(100),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const body = await parseBody(event, bodySchema)

  const id = ulid()
  const folderInsert = db.insert(mediaFolders).values({ id, siteId, name: body.name })

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'create',
    resource: 'media_folder',
    resourceId: id,
    after: { name: body.name },
  })

  await batchWithAudit(db, [folderInsert], auditInsert)

  return created(event, { id, name: body.name })
})
