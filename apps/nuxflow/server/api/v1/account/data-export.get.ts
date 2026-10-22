import { eq } from 'drizzle-orm'
import { useDb } from '../../../utils/db'
import { users } from '@nuxflow/db/schema'
import { collectUserData, collectUserDataFromPools, mergeUserData } from '../../../utils/account-data'

// Article 15 (right of access) / Article 20 (portability) self-service export. `users`
// is a single global account shared across every site in this D1 instance (no siteId
// column — see the multi-site note in CLAUDE.md), so every query is scoped to `userId`
// alone, across every site, matching hasSuperAdminRole()'s own "any site" model
// elsewhere in this codebase. On a hosting platform with member pools, each pool adds
// what it holds about the person (utils/account-data.ts); a pool that can't be reached
// is named in `incompleteFrom` rather than silently missing.
//
// Deliberately excludes: full content bodies (title/slug/dates only — the body is the
// site's content, not personal data about the author), raw media bytes (already
// browsable via the media library; only a summary list here), notifications,
// push_subscriptions, and ai_generation_jobs (operational/system records, not data the
// person volunteered), and API key secrets (only a one-way hash is ever stored, per
// CLAUDE.md — there is no secret to export).
//
// Every query is capped (collectUserData) so a single very active account can't produce
// an unbounded response — see CLAUDE.md's D1 export section for how costly an unbounded
// per-row read can get against real D1, even at a much smaller scale than a full DB dump.
export default defineEventHandler(async (event) => {
  // Account-wide export — accounts origin only under central sign-in (requireAccountSession).
  const session = await requireAccountSession(event)
  const userId = session.user.id
  const db = useDb(event)

  const [profile] = await db.select({
    id: users.id,
    name: users.name,
    email: users.email,
    image: users.image,
    phone: users.phone,
    emailVerified: users.emailVerified,
    createdAt: users.createdAt,
  }).from(users).where(eq(users.id, userId))

  if (!profile) {
    throw notFound('Account not found')
  }

  const [own, fromPools] = await Promise.all([collectUserData(db, userId), collectUserDataFromPools(event, userId)])

  setResponseHeader(event, 'content-disposition', `attachment; filename="nuxflow-data-export.json"`)

  return {
    exportedAt: new Date().toISOString(),
    profile,
    ...mergeUserData([own, ...fromPools.parts]),
    ...(fromPools.unreachable.length && { incompleteFrom: fromPools.unreachable }),
  }
})
