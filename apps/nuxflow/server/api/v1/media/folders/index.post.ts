import { z } from 'zod'
import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { mediaFolders } from '@nuxflow/db/schema'
import { ulid } from 'ulid'

const bodySchema = z.object({
  name: z.string().min(1).max(100).trim(),
})

export default defineEventHandler(async (event) => {
  await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const body = await readValidatedBody(event, bodySchema.parse)

  const id = ulid()
  await db.insert(mediaFolders).values({ id, siteId, name: body.name })

  setResponseStatus(event, 201)
  return { id, name: body.name }
})
