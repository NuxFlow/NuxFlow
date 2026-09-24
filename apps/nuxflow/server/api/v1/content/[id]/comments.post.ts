import { z } from 'zod'
import { useDb } from '../../../../utils/db'
import { ulid } from 'ulid'
import { rateLimit } from '../../../../utils/rate-limit'
import { created } from '../../../../utils/response'
import { getContentItemOrThrow } from '../../../../utils/content-queries'
import { getCommentByIdOrThrow } from '../../../../utils/resource-queries'
import { buildAuditLogInsert, batchWithAudit } from '../../../../utils/audit'
import { isSiteMemberForSession } from '../../../../utils/permissions'
import { waitUntil } from '../../../../utils/cf-env'
import { moderateText } from '../../../../utils/moderation'
import { comments, contentTypes } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

const bodySchema = z.object({
  guestName: z.string().min(1).max(100).optional(),
  guestEmail: z.email().optional(),
  body: z.string().min(1).max(5000),
  parentId: z.string().optional(),
})

export default defineEventHandler(async (event) => {
  await rateLimit(event, { limit: 10, windowMs: 60_000, keyPrefix: 'comments' })

  const siteId = event.context.siteId!
  const itemId = getRouterParam(event, 'id')!
  const parsed = await parseBody(event, bodySchema)

  const session = await getAuthSession(event).catch(() => null)

  // Guests must supply a name and email; logged-in users do not need to
  if (!session && (!parsed.guestName || !parsed.guestEmail)) {
    throw validationError('guestName and guestEmail are required for unauthenticated comments')
  }

  const db = useDb(event)

  // The three checks below are all independent D1 lookups — none reads a value another
  // produces — so they run concurrently rather than as three serialized round trips.
  // - The item must belong to this site — otherwise a caller could attach a comment to
  //   another tenant's content item by supplying its (unguessable but not secret) ULID.
  // - parentId has no DB-level FK (comments.parentId is deliberately a plain column —
  //   see CLAUDE.md/schema comment on why a self-referencing FK here risks silent data
  //   loss on a future migration), so nothing else verifies a caller-supplied parentId
  //   is actually an existing comment on THIS item/site. Without this, a caller could
  //   reply-thread onto an arbitrary/nonexistent id, or onto another tenant's comment by
  //   guessing its ULID, and have it silently accepted.
  // - Auto-approval requires actual membership of THIS site, not merely "has a valid
  //   session somewhere." Accounts/sessions are global across this multi-tenant install,
  //   so a bare session check would let a user with an account on any other site (or a
  //   self-registered account where public registration is enabled) post live,
  //   unmoderated comments here — the same cross-tenant gap requireAuth() exists to
  //   close for content access, applied to comment moderation instead. Reuses the
  //   `session` already fetched above instead of a second Better Auth lookup.
  const [item, , isMember] = await Promise.all([
    getContentItemOrThrow(db, siteId, itemId, 'Content item not found', { id: true, status: true, allowComments: true, typeId: true }),
    parsed.parentId
      ? getCommentByIdOrThrow(db, siteId, parsed.parentId, 'Parent comment not found', itemId)
      : Promise.resolve(null),
    isSiteMemberForSession(db, session, siteId),
  ])

  // Comments are a public-page feature: only published items with comments turned on
  // accept them. Without this, anyone holding an item's id could attach comments to a
  // draft or to a page whose comments are switched off — filling the moderation queue
  // with content no visitor could ever have posted through the site.
  // Per-item override takes precedence; null means "inherit from content type" (same
  // rule as api/public/pages/[slug].get.ts).
  const commentsEnabled = item.allowComments ?? (await db.query.contentTypes.findFirst({
    where: eq(contentTypes.id, item.typeId),
    columns: { hasComments: true },
  }))?.hasComments ?? false
  if (item.status !== 'published' || !commentsEnabled) {
    throw forbidden('Comments are not open on this item')
  }

  const status = isMember ? 'approved' : 'pending'

  const id = ulid()

  const commentInsert = db.insert(comments).values({
    id,
    siteId,
    itemId,
    authorId: session?.user?.id ?? null,
    parentId: parsed.parentId ?? null,
    guestName: session ? null : (parsed.guestName ?? null),
    guestEmail: session ? null : (parsed.guestEmail ?? null),
    body: parsed.body,
    status,
  })

  // Guest comments have no userId to attribute the action to, so only
  // authenticated submissions get an audit entry — matching the moderation
  // routes' actor-based pattern.
  const auditInsert = session?.user?.id
    ? buildAuditLogInsert(event, session.user.id, {
        action: 'create',
        resource: 'comment',
        resourceId: id,
        after: { itemId, status },
      })
    : null

  await batchWithAudit(db, [commentInsert], auditInsert)

  // Only bother AI-checking comments that already need human review — an approved member
  // comment skips this entirely (trusted account, no reason to spend a model call on it).
  if (status === 'pending') {
    waitUntil(event, (async () => {
      const result = await moderateText(event, parsed.body)
      if (result?.flagged) {
        await db.update(comments).set({ status: 'spam' }).where(and(eq(comments.id, id), eq(comments.siteId, siteId)))
      }
    })())
  }

  return created(event, { id, status })
})
