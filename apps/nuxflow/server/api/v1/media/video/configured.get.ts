import { requireRole } from '../../../../utils/permissions'
import { requireSiteId } from '../../../../utils/site-context'
import { useDb } from '../../../../utils/db'
import { checkPlanLimit, planLimitMessage } from '../../../../utils/hosting-plans'
import { uploadStreamAccount } from '../../../../utils/stream'

// Whether Media → Videos can upload, and why not. A hosted customer without their own
// Stream account uploads into the platform's, within the plan's video minutes.
export default defineEventHandler(async (event) => {
  await requireRole(event, 'author')
  const siteId = requireSiteId(event)

  const account = await uploadStreamAccount(event)
  if (!account) return { configured: false, account: null, message: null }
  if (account.kind === 'site') return { configured: true, account: 'site', message: null }

  const check = await checkPlanLimit(useDb(event), siteId, 'video', 1)
  return {
    configured: check.allowed,
    account: 'platform',
    message: check.allowed ? null : planLimitMessage('video', check.max ?? 0),
    minutesLeft: check.max === null ? null : Math.max(0, check.max - check.used),
  }
})
