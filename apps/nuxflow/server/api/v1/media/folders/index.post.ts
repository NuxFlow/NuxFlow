import { z } from 'zod'
import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { writeAuditLog } from '../../../../utils/audit'
import { mediaFolders } from '@nuxflow/db/schema'
import { ulid } from 'ulid'

const bodySchema = z.object({
  name: z.string().min(1).max(100).trim(),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const body = await parseBody(event, bodySchema)

  const id = ulid()
  await db.insert(mediaFolders).values({ id, siteId, name: body.name })

  await writeAuditLog(event, userId, {
    action: 'create',
    resource: 'media_folder',
    resourceId: id,
    after: { name: body.name },
  })

  setResponseStatus(event, 201)
  return { id, name: body.name }
})
