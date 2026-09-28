import { listUserSites } from '../../utils/accounts-sites'
import { isAccountsHost } from '../../utils/accounts-origin'

/** The signed-in person's sites, for the accounts home page's "Your sites" list. */
export default defineEventHandler(async (event) => {
  if (!isAccountsHost(event)) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  const session = await requireSession(event)
  return { sites: await listUserSites(event, session.user.id) }
})
