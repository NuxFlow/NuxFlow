import { z } from 'zod'
import { useDb } from '../../../../utils/db'
import { requireSuperAdmin } from '../../../../utils/permissions'
import { sites } from '@nuxflow/db/schema'
import { ulid } from 'ulid'

const bodySchema = z.object({
  name: z.string().min(1).max(100),
  domain: z.string().min(1),
  locale: z.string().default('en'),
  timezone: z.string().default('UTC'),
})

export default defineEventHandler(async (event) => {
  await requireSuperAdmin(event)
  const db = useDb(event)
  const body = await readValidatedBody(event, bodySchema.parse)

  const id = ulid()
  await db.insert(sites).values({ id, ...body, setupCompleted: false })
  setResponseStatus(event, 201)
  return { id }
})
