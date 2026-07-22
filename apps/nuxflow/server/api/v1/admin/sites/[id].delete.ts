import { requireSuperAdmin } from '../../../../utils/permissions'
import { deleteSiteCompletely } from '../../../../utils/site-deletion'

export default defineEventHandler(async (event) => {
  await requireSuperAdmin(event)
  const id = getRouterParam(event, 'id')!

  if (id === event.context.siteId) {
    throw createError({ statusCode: 409, message: 'Cannot delete the site you are currently viewing. Switch to another domain first.' })
  }

  await deleteSiteCompletely(event, id)

  return { id }
})
