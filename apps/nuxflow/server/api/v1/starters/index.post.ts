import { z } from 'zod'
import { requireRole } from '../../../utils/permissions'
import { requireSiteId } from '../../../utils/site-context'
import { writeAuditLog } from '../../../utils/audit'
import { starterIdSchema } from '../../../../shared/lib/starters'
import { cancelStarterInstall, startStarterInstall, stepStarterInstall } from '../../../utils/starters/install'

// One route for the three actions (each its own route file tipped `nuxt typecheck` into
// TS2589 — the generated route count is near TypeScript's limit, see CLAUDE.md).
const bodySchema = z.discriminatedUnion('action', [
  // Switch the site to a starter site. A built-in one is applied straight away; a catalog
  // one returns an install for the page to drive with 'step'. Nothing is deleted: the
  // site's current pages and posts become drafts.
  z.object({ action: z.literal('install'), starterId: starterIdSchema }),
  // The next part of an install (server/utils/starters/install.ts).
  z.object({ action: z.literal('step'), installId: z.string().min(1).max(64) }),
  // Stop an unfinished install and remove the images it had copied.
  z.object({ action: z.literal('cancel'), installId: z.string().min(1).max(64) }),
])

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const siteId = requireSiteId(event)
  const body = await parseBody(event, bodySchema)
  if (body.action === 'install') return startStarterInstall(event, siteId, userId, body.starterId)
  if (body.action === 'step') return stepStarterInstall(event, siteId, body.installId, userId)
  const install = await cancelStarterInstall(event, siteId, body.installId)
  await writeAuditLog(event, userId, { action: 'cancel', resource: 'starter', resourceId: install.starterId })
  return { install, result: null }
})
