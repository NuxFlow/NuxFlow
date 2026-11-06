import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import { classPasses } from '@nuxflow/db/schema'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { requireSiteId } from '../../../utils/site-context'
import { writeAuditLog } from '../../../utils/audit'
import { created } from '../../../utils/response'
import { grantPass, sendPassPurchasedEmail } from '../../../utils/class-passes'

const bodySchema = z.discriminatedUnion('action', [
  // A new kind of pass to sell.
  z.object({
    action: z.literal('create'),
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).nullish(),
    credits: z.number().int().min(1).max(1000),
    price: z.number().min(0.5).max(999_999),
    currency: z.string().regex(/^[a-z]{3}$/i, 'Use a three-letter currency code, such as GBP').transform(c => c.toUpperCase()),
    validDays: z.number().int().min(1).max(3650).nullish(),
  }),
  // Someone paid in person: their pass is added by hand, and no money moves here.
  z.object({
    action: z.literal('grant'),
    passId: z.string().min(1).max(64),
    name: z.string().trim().min(1).max(100),
    email: z.string().trim().max(254).email(),
  }),
])

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const body = await parseBody(event, bodySchema)

  if (body.action === 'grant') {
    const pass = await db.query.classPasses.findFirst({ where: and(eq(classPasses.id, body.passId), eq(classPasses.siteId, siteId)) })
    if (!pass) notFound('That pass was not found.')
    const holding = await grantPass(db, siteId, pass, { email: body.email, name: body.name })
    await sendPassPurchasedEmail(event, holding).catch(err => console.error('[class-passes] Pass email failed:', err))
    await writeAuditLog(event, userId, { action: 'create', resource: 'class_pass_holding', resourceId: holding.id, after: { passId: pass.id, credits: holding.creditsTotal } })
    return created(event, { id: holding.id })
  }

  const id = ulid()
  await db.insert(classPasses).values({
    id,
    siteId,
    name: body.name,
    description: body.description || null,
    credits: body.credits,
    price: body.price,
    currency: body.currency,
    validDays: body.validDays ?? null,
  })
  await writeAuditLog(event, userId, { action: 'create', resource: 'class_pass', resourceId: id, after: { name: body.name, credits: body.credits, price: body.price } })
  return created(event, { id })
})
