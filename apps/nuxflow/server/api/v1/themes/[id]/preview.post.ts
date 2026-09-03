import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { getThemeByIdOrThrow } from '../../../../utils/resource-queries'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  await getThemeByIdOrThrow(db, siteId, id, 'Theme not found', { id: true, packageName: true })

  // The real access control lives in server/middleware/06.theme-preview.ts, which
  // only honors `__theme_id` for an authenticated admin (or higher) of this
  // site — this endpoint itself already required that via requireRole above,
  // so the URL just needs to carry the theme id, not a bearer-style secret.
  const config = useRuntimeConfig()
  const previewUrl = `${config.public.siteUrl}/?__theme_id=${id}`

  return { previewUrl }
})
