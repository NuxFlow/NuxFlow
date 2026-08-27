import { z } from 'zod'
import { requireRole } from '../../../utils/permissions'
import { broadcastPushToSite } from '../../../utils/webpush'
import { writeAuditLog } from '../../../utils/audit'

const bodySchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(1000),
  url: z.string().url().optional(),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const input = await parseBody(event, bodySchema)

  await broadcastPushToSite(event, {
    title: input.title,
    body: input.body,
    url: input.url,
  })

  await writeAuditLog(event, userId, {
    action: 'create',
    resource: 'push_broadcast',
    after: input,
  })

  return { sent: true }
})
