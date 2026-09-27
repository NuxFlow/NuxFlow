import { redirects } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { writeAuditLog } from '../../../utils/audit'
import { getRedirectByIdOrThrow } from '../../../utils/resource-queries'
import { scopedById } from '../../../utils/db-helpers'
import { clearRedirectCache, normalizeRedirectPath } from '../../../utils/redirect-cache'
import { redirectRuleSchema, saveRedirect } from '../../../utils/redirects'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!
  const body = await parseBody(event, redirectRuleSchema)

  const existing = await getRedirectByIdOrThrow(db, siteId, id)

  // Changing the source path: refuse to collide with a different rule, then drop this
  // row so saveRedirect re-creates it under the new path (with chain flattening).
  if (normalizeRedirectPath(body.from) !== normalizeRedirectPath(existing.from)) {
    const clash = (await db.query.redirects.findMany({ where: eq(redirects.siteId, siteId), columns: { id: true, from: true } }))
      .find(r => r.id !== id && normalizeRedirectPath(r.from) === normalizeRedirectPath(body.from))
    if (clash) conflict(`A redirect from "${normalizeRedirectPath(body.from)}" already exists`)
    await db.delete(redirects).where(scopedById(redirects.id, id, redirects.siteId, siteId))
    clearRedirectCache(siteId)
  }

  const saved = await saveRedirect(db, siteId, body, { overwrite: true })

  await writeAuditLog(event, userId, {
    action: 'update',
    resource: 'redirect',
    resourceId: saved.id,
    before: existing,
    after: { from: saved.from, to: saved.to, statusCode: saved.statusCode },
  })

  return { id: saved.id, from: saved.from, to: saved.to, statusCode: saved.statusCode }
})
