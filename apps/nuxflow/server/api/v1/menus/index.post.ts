import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { requireAuth } from '../../../utils/permissions'
import { menus } from '@nuxflow/db/schema'
import { ulid } from 'ulid'

const bodySchema = z.object({
  name: z.string().min(1).max(100),
  location: z.enum(['header', 'footer', 'sidebar']).nullish(),
})

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const body = await readValidatedBody(event, bodySchema.parse)

  const id = ulid()
  await db.insert(menus).values({ id, siteId, name: body.name, location: body.location ?? null, items: [] })

  return { id }
})
