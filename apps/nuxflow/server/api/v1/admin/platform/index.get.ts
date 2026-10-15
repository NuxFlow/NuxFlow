import { useDb } from '../../../../utils/db'
import { requireSuperAdmin } from '../../../../utils/permissions'
import { isHostingPlatform } from '../../../../utils/hosting-platform'
import { getPrimarySite } from '../../../../utils/site-info'

/** Super Admin → Platform: whether this install runs as a hosting platform. */
export default defineEventHandler(async (event) => {
  await requireSuperAdmin(event)
  const primary = await getPrimarySite(event)
  return {
    hostingEnabled: await isHostingPlatform(useDb(event)),
    primarySite: primary ? { id: primary.id, name: primary.name, domain: primary.domain } : null,
  }
})
