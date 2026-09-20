import { requireSuperAdmin } from '../../../../utils/permissions'
import { deleteSiteCompletely } from '../../../../utils/site-deletion'

export default defineEventHandler(async (event) => {
  const { userId } = await requireSuperAdmin(event)
  const id = getRouterParam(event, 'id')!

  if (id === event.context.siteId) {
    throw conflict('Cannot delete the site you are currently viewing. Switch to another domain first.')
  }

  const { failedMediaDeletes } = await deleteSiteCompletely(event, id, userId)

  // Non-204 only when something needs the operator's attention — every previous
  // behaviour (silent success) is unchanged for the common case.
  if (failedMediaDeletes.length > 0) {
    return { failedMediaDeletes }
  }
  return noContent(event)
})
