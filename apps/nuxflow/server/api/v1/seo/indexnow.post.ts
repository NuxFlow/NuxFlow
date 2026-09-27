import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { writeAuditLog } from '../../../utils/audit'
import { rateLimit } from '../../../utils/rate-limit'
import { getSeoSettings } from '../../../utils/seo'
import { submitToIndexNow } from '../../../utils/indexnow'
import { getIndexableEntries } from '../../../utils/sitemap-entries'

/**
 * Admin → SEO → Indexing → "Submit all URLs now": sends every indexable URL (the sitemap's
 * list, up to IndexNow's 10,000-per-request limit) in one go — useful right after turning
 * IndexNow on, or after a domain move. Bypasses the per-URL throttle, so it's rate limited
 * itself.
 */
export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  await rateLimit(event, { limit: 3, windowMs: 60 * 60_000, keyPrefix: 'indexnow-submit-all' })
  const db = useDb(event)
  const siteId = event.context.siteId as string

  const seo = await getSeoSettings(db, siteId)
  if (!seo.indexnowEnabled) validationError('Turn IndexNow on and save before submitting URLs')

  const { entries } = await getIndexableEntries(db, siteId, seo, 10_000)
  const paths = [...new Set(['/', ...entries.map(e => e.path)])]
  const result = await submitToIndexNow(db, siteId, paths, { throttle: false })

  await writeAuditLog(event, userId, { action: 'update', resource: 'settings', after: { indexnowSubmitted: result.submitted.length } })
  return { submitted: result.submitted.length, status: result.status ?? null, skipped: result.skipped ?? null }
})
