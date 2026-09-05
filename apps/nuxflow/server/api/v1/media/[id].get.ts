import { useDb } from '../../../utils/db'
import { requireAuth } from '../../../utils/permissions'
import { getMediaByIdOrThrow } from '../../../utils/resource-queries'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  const file = await getMediaByIdOrThrow(db, siteId, id)

  return file
})
