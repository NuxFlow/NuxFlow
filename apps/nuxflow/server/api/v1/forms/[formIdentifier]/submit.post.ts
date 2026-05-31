import { z } from 'zod'
import { useDb } from '../../../../utils/db'
import { verifyTurnstile } from '../../../../utils/turnstile'
import { rateLimit } from '../../../../utils/rate-limit'
import { forms, formSubmissions } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'

const bodySchema = z.object({
  turnstileToken: z.string().optional(),
  data: z.record(z.unknown()),
})

export default defineEventHandler(async (event) => {
  await rateLimit(event, { limit: 10, windowMs: 60_000, keyPrefix: 'form-submit' })

  const db = useDb(event)
  const siteId = event.context.siteId as string
  const formIdentifier = getRouterParam(event, 'formIdentifier')!
  const body = await readValidatedBody(event, bodySchema.parse)

  const form = await db.query.forms.findFirst({
    where: and(eq(forms.siteId, siteId), eq(forms.slug, formIdentifier)),
  })
  if (!form) throw createError({ statusCode: 404, message: 'Form not found' })
  if (form.status !== 'active') throw createError({ statusCode: 403, message: 'This form is not accepting submissions' })

  const ip = getHeader(event, 'cf-connecting-ip') ?? getHeader(event, 'x-forwarded-for') ?? undefined
  const valid = await verifyTurnstile(body.turnstileToken ?? '', ip)
  if (!valid) throw createError({ statusCode: 422, message: 'Spam check failed' })

  const id = ulid()
  await db.insert(formSubmissions).values({
    id,
    formId: form.id,
    siteId,
    data: body.data,
    ipAddress: ip ?? null,
    userAgent: getHeader(event, 'user-agent') ?? null,
    status: 'new',
  })

  setResponseStatus(event, 201)
  return { success: true, redirectUrl: form.redirectUrl }
})
