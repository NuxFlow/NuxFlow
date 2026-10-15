import { z } from 'zod'
import { requireSuperAdmin } from '../../../../utils/permissions'
import { clearHostingPlatformCache, HOSTING_PLATFORM_SETTING_KEY } from '../../../../utils/hosting-platform'
import { clearHostingPlanCache } from '../../../../utils/hosting-plans'
import { eventForSite, getPrimarySite } from '../../../../utils/site-info'
import { saveSetting } from '../../../../utils/settings'
import { writeAuditLog } from '../../../../utils/audit'

const bodySchema = z.object({ hostingEnabled: z.boolean() })

/**
 * Turns "run this install as a hosting platform" on or off. Stored on the primary site
 * (hosting-platform.ts); turning it off puts every site back on unlimited without
 * touching their plan assignments, so turning it on again restores them.
 */
export default defineEventHandler(async (event) => {
  const { userId } = await requireSuperAdmin(event)
  const { hostingEnabled } = await parseBody(event, bodySchema)
  const primary = await getPrimarySite(event)
  if (!primary) throw conflict('No primary site is set, so there is nowhere to store this switch.')

  await saveSetting(eventForSite(event, primary.id), HOSTING_PLATFORM_SETTING_KEY, hostingEnabled ? true : null)
  clearHostingPlatformCache()
  clearHostingPlanCache()
  await writeAuditLog(event, userId, { action: 'update', resource: 'platform', resourceId: primary.id, after: { hostingEnabled } })
  return { hostingEnabled }
})
