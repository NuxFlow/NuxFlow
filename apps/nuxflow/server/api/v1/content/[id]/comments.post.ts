import { z } from 'zod'
import { useDb } from '../../../../utils/db'
import { comments } from '@nuxflow/db/schema'
import { ulid } from 'ulid'
import { rateLimit } from '../../../../utils/rate-limit'
import { created } from '../../../../utils/response'
import { getContentItemOrThrow } from '../../../../utils/content-queries'
import { buildAuditLogInsert, batchWithAudit } from '../../../../utils/audit'
import { getUserSiteRole, hasSuperAdminRole } from '../../../../utils/permissions'

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

  // The item must belong to this site — otherwise a caller could attach a comment
  // to another tenant's content item by supplying its (unguessable but not secret) ULID.
  await getContentItemOrThrow(db, siteId, itemId, 'Content item not found', { id: true })

  // Auto-approval requires actual membership of THIS site, not merely "has a valid
  // session somewhere." Accounts/sessions are global across this multi-tenant install,
  // so a bare session check would let a user with an account on any other site (or a
  // self-registered account where public registration is enabled) post live,
  // unmoderated comments here — the same cross-tenant gap requireAuth() exists to
  // close for content access, applied to comment moderation instead.
  let isSiteMember = false
  if (session?.user?.id) {
    const roleRow = await getUserSiteRole(db, session.user.id, siteId)
    isSiteMember = Boolean(roleRow) || (await hasSuperAdminRole(db, session.user.id))
  }
  const status = isSiteMember ? 'approved' : 'pending'

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

  return created(event, { id, status })
})
