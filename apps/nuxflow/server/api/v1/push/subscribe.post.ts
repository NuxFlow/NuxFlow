import { z } from 'zod'
import { requireSiteUser } from '../../../utils/permissions'
import { useDb } from '../../../utils/db'
import { pushSubscriptions } from '@nuxflow/db/schema'
import { and, asc, eq, notInArray } from 'drizzle-orm'
import { ulid } from 'ulid'
import { created, validationError } from '../../../utils/response'
import { rateLimit } from '../../../utils/rate-limit'
import { isKnownPushService } from '../../../utils/webpush'
import { requireSiteId } from '../../../utils/site-context'

// One row per browser/device. Ten is far more than anyone uses; past it the oldest go,
// so a bulk registration can't grow the broadcast list without bound.
const MAX_SUBSCRIPTIONS_PER_USER = 10

const bodySchema = z.object({
  endpoint: z.string().url().max(2048),
  // A P-256 public key and a 16-byte secret, base64url — generous upper bounds.
  p256dh: z.string().min(1).max(200),
  auth: z.string().min(1).max(100),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireSiteUser(event)
  await rateLimit(event, { limit: 20, windowMs: 60 * 60_000, keyPrefix: 'push-subscribe' })
  const siteId = requireSiteId(event)
  const body = await parseBody(event, bodySchema)
  const db = useDb(event)

  // endpoint is browser-supplied — without this any signed-in member could register a URL
  // on any host (an internal address, or someone else's server) and have this Worker POST
  // to it on every broadcast. See isKnownPushService().
  if (!isKnownPushService(body.endpoint)) {
    validationError('Invalid push subscription endpoint')
  }

  // Upsert: replace any existing subscription for this user+site+endpoint triple.
  // siteId must be part of the match — a user who belongs to multiple sites can
  // legitimately re-subscribe with the same browser/endpoint on a second site, and
  // without siteId here that would silently overwrite the first site's row instead
  // of creating a distinct one, leaving that site's broadcastPushToSite() unable to
  // find it.
  const existing = await db.query.pushSubscriptions.findFirst({
    where: and(
      eq(pushSubscriptions.userId, userId),
      eq(pushSubscriptions.siteId, siteId),
      eq(pushSubscriptions.endpoint, body.endpoint),
    ),
    columns: { id: true },
  })

  if (existing) {
    await db.update(pushSubscriptions)
      .set({ p256dh: body.p256dh, auth: body.auth })
      .where(and(eq(pushSubscriptions.id, existing.id), eq(pushSubscriptions.siteId, siteId)))
  } else {
    const id = ulid()
    await db.insert(pushSubscriptions).values({
      id,
      siteId,
      userId,
      endpoint: body.endpoint,
      p256dh: body.p256dh,
      auth: body.auth,
    })

    const keep = await db.select({ id: pushSubscriptions.id }).from(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.siteId, siteId)))
      .orderBy(asc(pushSubscriptions.createdAt), asc(pushSubscriptions.id))
    if (keep.length > MAX_SUBSCRIPTIONS_PER_USER) {
      await db.delete(pushSubscriptions).where(and(
        eq(pushSubscriptions.userId, userId),
        eq(pushSubscriptions.siteId, siteId),
        notInArray(pushSubscriptions.id, keep.slice(-MAX_SUBSCRIPTIONS_PER_USER).map(r => r.id)),
      ))
    }
  }

  return created(event, { subscribed: true })
})
