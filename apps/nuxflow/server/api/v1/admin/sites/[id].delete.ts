import { requireSuperAdmin } from '../../../../utils/permissions'
import { deleteSiteCompletely } from '../../../../utils/site-deletion'

export default defineEventHandler(async (event) => {
  const { userId } = await requireSuperAdmin(event)
  const id = getRouterParam(event, 'id')!

  if (id === event.context.siteId) {
    throw conflict('Cannot delete the site you are currently viewing. Switch to another domain first.')
  }

  await deleteSiteCompletely(event, id, userId)

  return noContent(event)
})
