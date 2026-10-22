import { listUserSites } from '../../utils/accounts-sites'
import { requireAccountsHost } from '../../utils/accounts-origin'

/** The signed-in person's sites, for the accounts home page's "Your sites" list. */
export default defineEventHandler(async (event) => {
  requireAccountsHost(event)
  const session = await requireSession(event)
  return { sites: await listUserSites(event, session.user.id) }
})
