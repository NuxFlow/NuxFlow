import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { getFormByIdOrThrow } from '../../../../utils/resource-queries'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const formIdentifier = getRouterParam(event, 'formIdentifier')!

  return await getFormByIdOrThrow(db, siteId, formIdentifier)
})
