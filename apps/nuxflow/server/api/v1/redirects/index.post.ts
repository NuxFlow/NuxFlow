import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { writeAuditLog } from '../../../utils/audit'
import { redirects } from '@nuxflow/db/schema'
import { ulid } from 'ulid'

const bodySchema = z.object({
  from: z.string().startsWith('/'),
  to: z.string().min(1),
  statusCode: z.union([z.literal(301), z.literal(302)]).default(301),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const body = await parseBody(event, bodySchema)

  const id = ulid()
  await db.insert(redirects).values({ id, siteId, ...body })

  await writeAuditLog(event, userId, {
    action: 'create',
    resource: 'redirect',
    resourceId: id,
    after: body,
  })

  setResponseStatus(event, 201)
  return { id }
})
