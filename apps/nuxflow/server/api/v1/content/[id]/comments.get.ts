import { useDb } from '../../../../utils/db'
import { isSiteMember } from '../../../../utils/permissions'
import { comments } from '@nuxflow/db/schema'
import { and, eq, desc } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const siteId = event.context.siteId!
  const itemId = getRouterParam(event, 'id')!

  const db = useDb(event)

  // "a session exists" is not the same as "this user belongs to THIS site" — user accounts
  // are global across this multi-tenant install, so gating on mere authentication would let
  // any user with a session anywhere see another site's pending/spam comments (guest names
  // + bodies included). Require real site membership (or super-admin), matching every other
  // admin-visible-data check in the codebase.
  const canModerate = await isSiteMember(event)

  const rows = await db.query.comments.findMany({
    where: and(
      eq(comments.itemId, itemId),
      eq(comments.siteId, siteId),
      canModerate ? undefined : eq(comments.status, 'approved'),
    ),
    orderBy: [desc(comments.createdAt)],
  })

  // Strip guest commenter email — only the admin moderation endpoint exposes this
  return { comments: rows.map(({ guestEmail: _guestEmail, ...rest }) => rest) }
})
