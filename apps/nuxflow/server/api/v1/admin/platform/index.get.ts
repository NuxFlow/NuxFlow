import { useDb } from '../../../../utils/db'
import { requireSuperAdmin } from '../../../../utils/permissions'
import { isHostingPlatform } from '../../../../utils/hosting-platform'
import { eventForSite, getPrimarySite } from '../../../../utils/site-info'
import { accountsUrl, isCentralAuth } from '../../../../utils/accounts-origin'
import { HOSTING_WEBHOOK_SECRET_KEY, hostingSitesDomain } from '../../../../utils/hosting-billing'
import { resolveSetting } from '../../../../utils/settings'

/** Super Admin → Platform: the hosting switch, and what selling sites still needs. */
export default defineEventHandler(async (event) => {
  await requireSuperAdmin(event)
  const primary = await getPrimarySite(event)
  const primaryEvent = primary ? eventForSite(event, primary.id) : null
  const [hostingEnabled, stripeKey, webhookSecret] = await Promise.all([
    isHostingPlatform(useDb(event)),
    primaryEvent ? resolveSetting(primaryEvent, 'payments.stripe_secret_key', 'stripeSecretKey') : '',
    primaryEvent ? resolveSetting(primaryEvent, HOSTING_WEBHOOK_SECRET_KEY) : '',
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
  }
})
