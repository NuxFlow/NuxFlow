import { useDb } from '../../../../utils/db'
import { requireSuperAdmin } from '../../../../utils/permissions'
import { isHostingPlatform } from '../../../../utils/hosting-platform'
import { eventForSite, getPrimarySite } from '../../../../utils/site-info'
import { accountsUrl, isCentralAuth } from '../../../../utils/accounts-origin'
import { HOSTING_WEBHOOK_SECRET_KEY, hostingSitesDomain } from '../../../../utils/hosting-billing'
import { resolveSetting } from '../../../../utils/settings'
import { customDomainTarget, SAAS_TOKEN_KEY, SAAS_ZONE_KEY } from '../../../../utils/hosting-domains'
import { getAiDailyCap, platformAiCreditsToday } from '../../../../utils/ai-allowance'
import { ANALYTICS_TOKEN_KEY } from '../../../../utils/analytics'
import { getAnalyticsEngine } from '../../../../utils/cf-env'

/** Super Admin → Platform: the hosting switch, and what selling sites still needs. */
export default defineEventHandler(async (event) => {
  await requireSuperAdmin(event)
  const primary = await getPrimarySite(event)
  const primaryEvent = primary ? eventForSite(event, primary.id) : null
  const db = useDb(event)
  const [hostingEnabled, stripeKey, webhookSecret, cfZoneId, cfToken, target, aiDailyCap, aiCreditsToday, analyticsToken, accountId] = await Promise.all([
    isHostingPlatform(db),
    primaryEvent ? resolveSetting(primaryEvent, 'payments.stripe_secret_key', 'stripeSecretKey') : '',
    primaryEvent ? resolveSetting(primaryEvent, HOSTING_WEBHOOK_SECRET_KEY) : '',
    primaryEvent ? resolveSetting(primaryEvent, SAAS_ZONE_KEY) : '',
    primaryEvent ? resolveSetting(primaryEvent, SAAS_TOKEN_KEY) : '',
    primaryEvent ? customDomainTarget(primaryEvent) : '',
    getAiDailyCap(db),
    platformAiCreditsToday(db, primary?.id ?? null),
    primaryEvent ? resolveSetting(primaryEvent, ANALYTICS_TOKEN_KEY) : '',
    primaryEvent ? resolveSetting(primaryEvent, 'cloudflare.account_id', 'cloudflareAccountId') : '',
  ])
  const central = isCentralAuth()
  return {
    hostingEnabled,
    primarySite: primary ? { id: primary.id, name: primary.name, domain: primary.domain } : null,
    centralAuth: central,
    sitesDomain: hostingSitesDomain() || null,
    stripeConfigured: !!stripeKey,
    webhookSecretSet: !!webhookSecret,
    webhookUrl: central ? accountsUrl('/api/accounts/hosting/stripe-webhook') : null,
    signUpUrl: central ? accountsUrl('/account/hosting/new') : null,
    // Customers' own domains (Cloudflare for SaaS on the sites domain's zone).
    customDomains: {
      zoneId: cfZoneId ? String(cfZoneId) : null,
      tokenSet: !!cfToken,
      target: target || null,
    },
    // Platform-wide daily brake on AI the platform pays for (ai-allowance.ts).
    ai: { dailyCap: aiDailyCap, creditsToday: aiCreditsToday },
    // Visitor analytics (analytics.ts): recorded through the AE binding, read back with
    // the operator's API token. Not a hosting feature — shown on every install.
    analytics: {
      recording: getAnalyticsEngine(event) !== null,
      dataset: useRuntimeConfig().analyticsDataset,
      tokenSet: !!analyticsToken,
      accountId: accountId ? String(accountId) : null,
    },
  }
})
