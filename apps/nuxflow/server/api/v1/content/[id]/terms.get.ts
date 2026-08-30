import { useDb } from '../../../../utils/db'
import { requireAuth } from '../../../../utils/permissions'
import { getContentItemOrThrow } from '../../../../utils/content-queries'
import { getContentItemTerms } from '@nuxflow/db/queries'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const itemId = getRouterParam(event, 'id')!

  await getContentItemOrThrow(db, siteId, itemId, 'Content item not found', { id: true })

  const rows = await getContentItemTerms(db, itemId)

  return { terms: rows }
})
