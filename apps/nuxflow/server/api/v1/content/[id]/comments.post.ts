import { z } from 'zod'
import { useDb } from '../../../../utils/db'
import { comments } from '@nuxflow/db/schema'
import { ulid } from 'ulid'
import { rateLimit } from '../../../../utils/rate-limit'

const bodySchema = z.object({
  guestName: z.string().min(1).max(100).optional(),
  guestEmail: z.string().email().optional(),
  body: z.string().min(1).max(5000),
  parentId: z.string().optional(),
})

export default defineEventHandler(async (event) => {
  await rateLimit(event, { limit: 10, windowMs: 60_000, keyPrefix: 'comments' })

  const siteId = event.context.siteId!
  const itemId = getRouterParam(event, 'id')!
  const parsed = await readValidatedBody(event, bodySchema.parse)

  const session = await getUserSession(event).catch(() => null)

  // Guests must supply a name and email; logged-in users do not need to
  if (!session && (!parsed.guestName || !parsed.guestEmail)) {
    throw createError({ statusCode: 422, message: 'guestName and guestEmail are required for unauthenticated comments' })
  }

  const db = useDb(event)
  const id = ulid()

  await db.insert(comments).values({
    id,
    siteId,
    itemId,
    authorId: session?.user?.id ?? null,
    parentId: parsed.parentId ?? null,
    guestName: session ? null : (parsed.guestName ?? null),
    guestEmail: session ? null : (parsed.guestEmail ?? null),
    body: parsed.body,
    status: session ? 'approved' : 'pending',
  })

  setResponseStatus(event, 201)
  return { id, status: session ? 'approved' : 'pending' }
})
