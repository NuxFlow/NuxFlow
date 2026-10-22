import { z } from 'zod'
import { requireSuperAdmin } from '../../../../utils/permissions'
import { requireControlPlane } from '../../../../utils/control-plane'
import { clearHostingPlatformCache, HOSTING_PLATFORM_SETTING_KEY } from '../../../../utils/hosting-platform'
import { clearHostingPlanCache } from '../../../../utils/hosting-plans'
import { HOSTING_WEBHOOK_SECRET_KEY } from '../../../../utils/hosting-billing'
import { SAAS_TARGET_KEY, SAAS_TOKEN_KEY, SAAS_ZONE_KEY } from '../../../../utils/hosting-domains'
import { normalizeDomain } from '../../../../utils/domain'
import { eventForSite, getPrimarySite } from '../../../../utils/site-info'
import { saveSetting } from '../../../../utils/settings'
import { writeAuditLog } from '../../../../utils/audit'
import { pushSettingsToPools } from '../../../../utils/pools'
import { waitUntil } from '../../../../utils/cf-env'
import { AI_DAILY_CAP_SETTING_KEY, clearAiDailyCapCache } from '../../../../utils/ai-allowance'
import { ANALYTICS_TOKEN_KEY, clearAnalyticsCache } from '../../../../utils/analytics'

const bodySchema = z.object({
  hostingEnabled: z.boolean().optional(),
  /** Stripe's signing secret for the hosting webhook (whsec_…); '' removes it. */
  stripeWebhookSecret: z.string().trim().max(200).optional(),
  /** Cloudflare for SaaS on the sites domain's zone: its zone id, an API token, the CNAME target. '' removes. */
  cfZoneId: z.string().trim().regex(/^(?:[a-f0-9]{32})?$/i, 'A zone ID is 32 letters and numbers (Cloudflare → your sites domain → Overview).').optional(),
  cfApiToken: z.string().trim().max(200).optional(),
  customDomainTarget: z.string().trim().max(253).optional(),
  /** Most AI credits all customer sites together may use per UTC day; null removes the cap. */
  aiDailyCreditCap: z.number().int().min(0).max(100_000_000).nullable().optional(),
  /** Visitor analytics: an API token with Account Analytics Read; '' removes it. */
  analyticsApiToken: z.string().trim().max(200).optional(),
  /** The Cloudflare account the Worker runs in (also used by Stream/Images); '' removes it. */
  cloudflareAccountId: z.string().trim().regex(/^(?:[a-f0-9]{32})?$/i, 'An account ID is 32 letters and numbers (Cloudflare dashboard → Account home → the ⋯ menu next to your account → Copy account ID).').optional(),
})

/**
 * Platform settings, stored on the primary site (hosting-platform.ts). Turning hosting
 * off puts every site back on unlimited without touching their plan assignments, so
 * turning it on again restores them.
 */
export default defineEventHandler(async (event) => {
  requireControlPlane(event)
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
  if (body.cfZoneId !== undefined) await saveSetting(primaryEvent, SAAS_ZONE_KEY, body.cfZoneId.toLowerCase() || null)
  if (body.cfApiToken !== undefined) await saveSetting(primaryEvent, SAAS_TOKEN_KEY, body.cfApiToken || null)
  if (body.customDomainTarget !== undefined) {
    const target = body.customDomainTarget ? normalizeDomain(body.customDomainTarget) : ''
    if (target === null) throw validationError('Enter the CNAME target as a hostname, e.g. customers.nuxflow.site.')
    await saveSetting(primaryEvent, SAAS_TARGET_KEY, target || null)
  }
  if (body.aiDailyCreditCap !== undefined) {
    await saveSetting(primaryEvent, AI_DAILY_CAP_SETTING_KEY, body.aiDailyCreditCap)
    clearAiDailyCapCache()
  }
  if (body.analyticsApiToken !== undefined) await saveSetting(primaryEvent, ANALYTICS_TOKEN_KEY, body.analyticsApiToken || null)
  if (body.cloudflareAccountId !== undefined) await saveSetting(primaryEvent, 'cloudflare.account_id', body.cloudflareAccountId.toLowerCase() || null)
  if (body.analyticsApiToken !== undefined || body.cloudflareAccountId !== undefined) clearAnalyticsCache()
  // Member pools keep their own copy of these (control-plane.ts) — send it on. In the
  // background: an unreachable pool mustn't fail the save, and Super Admin → Pools can resend.
  if (body.aiDailyCreditCap !== undefined || body.analyticsApiToken !== undefined || body.cloudflareAccountId !== undefined) {
    waitUntil(event, pushSettingsToPools(event))
  }
  await writeAuditLog(event, userId, {
    action: 'update',
    resource: 'platform',
    resourceId: primary.id,
    after: {
      hostingEnabled: body.hostingEnabled,
      stripeWebhookSecret: body.stripeWebhookSecret === undefined ? undefined : (body.stripeWebhookSecret ? 'set' : 'removed'),
      cfZoneId: body.cfZoneId,
      cfApiToken: body.cfApiToken === undefined ? undefined : (body.cfApiToken ? 'set' : 'removed'),
      customDomainTarget: body.customDomainTarget,
      aiDailyCreditCap: body.aiDailyCreditCap,
      analyticsApiToken: body.analyticsApiToken === undefined ? undefined : (body.analyticsApiToken ? 'set' : 'removed'),
      cloudflareAccountId: body.cloudflareAccountId,
    },
  })
  return { hostingEnabled: body.hostingEnabled }
})
