import { z } from 'zod'
import { requireRole } from '../../../utils/permissions'
import { requireSiteId } from '../../../utils/site-context'
import { useDb } from '../../../utils/db'
import { resolveSetting } from '../../../utils/settings'
import { getOpenInstall, installView, listStarters, starterStorageReady } from '../../../utils/starters/install'
import { APPLIED_STARTER_SETTING } from '../../../utils/starters/apply'
import type { AppliedStarter } from '../../../../shared/lib/starters'

const querySchema = z.object({
  // The dashboard banner only needs the unfinished install, not the catalog.
  installOnly: z.enum(['1', 'true']).optional(),
})

/** Admin → Starter sites: what can be installed, and any install in progress. */
export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const siteId = requireSiteId(event)
  const query = await parseQuery(event, querySchema)
  const open = await getOpenInstall(useDb(event), siteId)
  const install = open ? installView(open) : null
  if (query.installOnly) return { install }

  const [{ starters, catalogError }, storageReady, applied] = await Promise.all([
    listStarters(event),
    starterStorageReady(event),
    resolveSetting(event, APPLIED_STARTER_SETTING),
  ])
  const last = applied && typeof applied === 'object' ? applied as AppliedStarter : null
  return {
    starters,
    catalogError,
    storageReady,
    install,
    applied: last ? { id: last.id, name: last.name, at: last.at } : null,
  }
})
