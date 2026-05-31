import { z } from 'zod'
import { membershipTiers } from '@nuxflow/db/schema'
import { ulid } from 'ulid'

const bodySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  price: z.number().min(0),
  currency: z.string().length(3).default('USD'),
  interval: z.enum(['month', 'year', 'one_time']).default('month'),
  features: z.array(z.string()).default([]),
})

export default defineEventHandler(async (event) => {
  const siteId = event.context.siteId as string
  const body = await readValidatedBody(event, bodySchema.parse)

  const db = useDb()
  const id = ulid()

  await db.insert(membershipTiers).values({
    id,
    siteId,
    name: body.name,
    description: body.description ?? null,
    price: body.price,
    currency: body.currency,
    interval: body.interval,
    features: body.features,
    isActive: true,
  })

  const tier = await db.query.membershipTiers.findFirst({
    where: (t, { eq: eq_ }) => eq_(t.id, id),
  })

  setResponseStatus(event, 201)
  return tier
})
