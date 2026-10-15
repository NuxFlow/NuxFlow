import { z } from 'zod'
import { requireSuperAdmin } from '../../../../utils/permissions'
import { clearHostingPlatformCache, HOSTING_PLATFORM_SETTING_KEY } from '../../../../utils/hosting-platform'
import { clearHostingPlanCache } from '../../../../utils/hosting-plans'
import { HOSTING_WEBHOOK_SECRET_KEY } from '../../../../utils/hosting-billing'
import { eventForSite, getPrimarySite } from '../../../../utils/site-info'
import { saveSetting } from '../../../../utils/settings'
import { writeAuditLog } from '../../../../utils/audit'

const bodySchema = z.object({
  hostingEnabled: z.boolean().optional(),
  /** Stripe's signing secret for the hosting webhook (whsec_…); '' removes it. */
  stripeWebhookSecret: z.string().trim().max(200).optional(),
})

/**
 * Platform settings, stored on the primary site (hosting-platform.ts). Turning hosting
 * off puts every site back on unlimited without touching their plan assignments, so
 * turning it on again restores them.
 */
export default defineEventHandler(async (event) => {
  const { userId } = await requireSuperAdmin(event)
  const body = await parseBody(event, bodySchema)
  const primary = await getPrimarySite(event)
  if (!primary) throw conflict('No primary site is set, so there is nowhere to store these settings.')
  const primaryEvent = eventForSite(event, primary.id)

  if (body.hostingEnabled !== undefined) {
    await saveSetting(primaryEvent, HOSTING_PLATFORM_SETTING_KEY, body.hostingEnabled ? true : null)
    clearHostingPlatformCache()
    clearHostingPlanCache()
  }
  if (body.stripeWebhookSecret !== undefined) {
    if (body.stripeWebhookSecret && !body.stripeWebhookSecret.startsWith('whsec_')) {
      throw validationError('That doesn\'t look like a Stripe signing secret. It starts with whsec_.')
    }
    await saveSetting(primaryEvent, HOSTING_WEBHOOK_SECRET_KEY, body.stripeWebhookSecret || null)
  }
  await writeAuditLog(event, userId, {
    action: 'update',
    resource: 'platform',
    resourceId: primary.id,
    after: { hostingEnabled: body.hostingEnabled, stripeWebhookSecret: body.stripeWebhookSecret === undefined ? undefined : (body.stripeWebhookSecret ? 'set' : 'removed') },
  })
  return { hostingEnabled: body.hostingEnabled }
})
