import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { requireAuth } from '../../../utils/permissions'
import { writeAuditLog } from '../../../utils/audit'
import { menus } from '@nuxflow/db/schema'
import { ulid } from 'ulid'

const bodySchema = z.object({
  name: z.string().min(1).max(100),
  location: z.enum(['header', 'footer', 'sidebar']).nullish(),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireAuth(event)
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const body = await parseBody(event, bodySchema)

  const id = ulid()
  await db.insert(menus).values({ id, siteId, name: body.name, location: body.location ?? null, items: [] })

  await writeAuditLog(event, userId, {
    action: 'create',
    resource: 'menu',
    resourceId: id,
    after: { name: body.name, location: body.location ?? null },
  })

  return { id }
})
