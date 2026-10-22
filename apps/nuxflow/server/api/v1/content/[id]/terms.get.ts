import { useDb } from '../../../../utils/db'
import { requireAuth } from '../../../../utils/permissions'
import { getContentItemOrThrow } from '../../../../utils/content-queries'
import { getContentItemTerms } from '@nuxflow/db/queries'
import { requireSiteId } from '../../../../utils/site-context'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const itemId = getRouterParam(event, 'id')!

  await getContentItemOrThrow(db, siteId, itemId, 'Content item not found', { id: true })

  const rows = await getContentItemTerms(db, siteId, itemId)

  return { terms: rows }
})
