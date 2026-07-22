import { requireRole } from '../../../utils/permissions'
import { deleteSiteCompletely } from '../../../utils/site-deletion'
import { useDb } from '../../../utils/db'
import { sites } from '@nuxflow/db/schema'
import { asc } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'super_admin')
  const siteId = event.context.siteId as string
  const db = useDb(event)

  // The "main" site is simply the oldest one — there's no separate flag for
  // it. It's the site that was either the very first install, or (if that one
  // has since been deleted) whichever site is now the longest-running.
  const allSites = await db.query.sites.findMany({
    columns: { id: true, name: true, domain: true },
    orderBy: [asc(sites.createdAt)],
  })

  const isMain = allSites[0]?.id === siteId

  if (isMain && allSites.length > 1) {
    const blockingSites = allSites.filter(s => s.id !== siteId)
    throw createError({
      statusCode: 409,
      message: `This is the main site — delete the other ${blockingSites.length} site${blockingSites.length === 1 ? '' : 's'} first: ${blockingSites.map(s => s.domain).join(', ')}`,
      data: { blockingSites },
    })
  }

  // Always a full delete — main site when it's the last one left, or any
  // addon site regardless of how many others remain. Re-provisioning an addon
  // domain afterward goes through the normal Super Admin → Sites → New flow,
  // the same as adding any other new site.
  const wasLastSite = allSites.length === 1
  await deleteSiteCompletely(event, siteId)
  return { id: siteId, wasLastSite }
})
