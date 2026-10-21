import { z } from 'zod'
import { requireRole } from '../../../utils/permissions'
import { broadcastPushToSite } from '../../../utils/webpush'
import { writeAuditLog } from '../../../utils/audit'

const bodySchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(1000),
  // A site path ("/blog/my-post", what the form's hint asks for) or a full http(s) URL.
  // "//host" and "/\host" are refused as paths: browsers read both as another site.
  url: z.union([
    z.string().max(2000).regex(/^\/(?![/\\])/, 'Use a path starting with / or a full URL'),
    z.string().url().max(2000).regex(/^https?:\/\//i, 'Use a path starting with / or a full URL'),
  ]).optional(),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const input = await parseBody(event, bodySchema)

  const result = await broadcastPushToSite(event, {
    title: input.title,
    body: input.body,
    url: input.url,
  })

  await writeAuditLog(event, userId, {
    action: 'create',
    resource: 'push_broadcast',
    after: input,
  })

  return { sent: true, ...result }
})
