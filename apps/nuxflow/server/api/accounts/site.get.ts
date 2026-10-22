import { z } from 'zod'
import { getSiteBranding } from '../../utils/accounts-sites'
import { requireAccountsHost } from '../../utils/accounts-origin'

const querySchema = z.object({ site: z.string().min(1).max(64) })

/** A site's name/logo/colour for branding the accounts origin's pages — data only. */
export default defineEventHandler(async (event) => {
  requireAccountsHost(event)
  const { site: siteId } = parseQuery(event, querySchema)
  const site = await getSiteBranding(event, siteId)
  if (!site) throw notFound('This site isn\'t available')
  return site
})
