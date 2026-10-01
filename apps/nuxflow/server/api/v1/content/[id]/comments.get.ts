import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { getContentItemOrThrow } from '../../../../utils/content-queries'
import { checkContentAccess } from '../../../../utils/content-access'
import { comments } from '@nuxflow/db/schema'
import { and, eq, desc } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const siteId = event.context.siteId!
  const itemId = getRouterParam(event, 'id')!

  const db = useDb(event)

  // Pending/spam comments are for moderators only — the same editor floor as the
  // moderation routes (api/v1/comments/**). Any site role used to be enough, which showed
  // the moderation queue to every self-registered `member`. (Site-scoped: accounts are
  // global, so a role on another site counts for nothing here.)
  const canModerate = await requireRole(event, 'editor').then(() => true, () => false)

  const item = await getContentItemOrThrow(db, siteId, itemId, 'Content item not found', {
    status: true, visibility: true, settings: true,
  })

  // Everyone else sees a page's discussion only where they could see the page itself:
  // published, and past the same members/tier gate as GET /api/public/pages. Without this,
  // an item id was enough to read the comments on a draft, private or members-only page.
  if (!canModerate) {
    const gate = item.status === 'published'
      ? await checkContentAccess(event, { visibility: item.visibility, settings: item.settings as Record<string, unknown> | null }, siteId)
      : { blocked: true }
    if (gate) throw notFound('Content item not found')
  }

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
