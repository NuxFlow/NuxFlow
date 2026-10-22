import { useDb } from '../../../utils/db'
import { requireAuth } from '../../../utils/permissions'
import { getMediaByIdOrThrow } from '../../../utils/resource-queries'
import { requireSiteId } from '../../../utils/site-context'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const id = getRouterParam(event, 'id')!

  const file = await getMediaByIdOrThrow(db, siteId, id)

  return file
})
