import { z } from 'zod'
import { consentLogs } from '@nuxflow/db/schema'
import { ulid } from 'ulid'
import { useDb } from '../../utils/db'
import { rateLimit } from '../../utils/rate-limit'

// Called by @nuxflow/canvas's writeConsentCookie() (packages/canvas/src/utils/consent.ts)
// as a fire-and-forget side effect whenever either consent UI saves a choice — see that
// function's comment for why this table exists (server-side proof-of-consent, independent
// of the visitor's own cookie). Deliberately records no visitor-identifying data (no
// userId, no IP, no cookie/session id — see the comment on consentLogs in
// packages/db/src/schema/system.ts), so this is a low-value target and doesn't need the
// stricter per-IP limits sensitive routes (registration, password reset) use — generous
// enough that no real visitor clicking a consent banner a few times could ever hit it.
const bodySchema = z.object({
  analytics: z.boolean(),
  marketing: z.boolean(),
})

export default defineEventHandler(async (event) => {
  await rateLimit(event, { limit: 30, windowMs: 60 * 60_000, keyPrefix: 'public-consent' })

  const siteId = event.context.siteId as string | null
  if (!siteId) return noContent(event)

  const body = await parseBody(event, bodySchema)
  const db = useDb(event)

  await db.insert(consentLogs).values({
    id: ulid(),
    siteId,
    analytics: body.analytics,
    marketing: body.marketing,
    userAgent: (getRequestHeader(event, 'user-agent') ?? '').slice(0, 256),
  })

  return noContent(event)
})
