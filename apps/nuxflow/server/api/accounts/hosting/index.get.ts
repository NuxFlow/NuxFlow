import { isAccountsHost, isCentralAuth } from '../../../utils/accounts-origin'
import { isHostingPlatform } from '../../../utils/hosting-platform'
import { hostingSitesDomain, listPublicPlans } from '../../../utils/hosting-billing'
import { useDb } from '../../../utils/db'

/**
 * Is hosting sign-up open here, and what's for sale. Public, so the sign-up page can show
 * plans before anyone signs in. `enabled: false` (not a 404) lets the account page simply
 * leave its hosting link out.
 */
export default defineEventHandler(async (event) => {
  const db = useDb(event)
  const enabled = isCentralAuth() && isAccountsHost(event) && await isHostingPlatform(db) && !!hostingSitesDomain()
  if (!enabled) return { enabled: false as const, sitesDomain: null, plans: [] }
  return { enabled: true as const, sitesDomain: hostingSitesDomain(), plans: await listPublicPlans(db) }
})
