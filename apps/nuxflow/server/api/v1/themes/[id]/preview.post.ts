import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { themes } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  const theme = await db.query.themes.findFirst({
    where: and(eq(themes.id, id), eq(themes.siteId, siteId)),
    columns: { id: true, packageName: true },
  })
  if (!theme) throw notFound('Theme not found')

  // The real access control lives in server/middleware/theme-preview.ts, which
  // only honors `__theme_id` for an authenticated admin (or higher) of this
  // site — this endpoint itself already required that via requireRole above,
  // so the URL just needs to carry the theme id, not a bearer-style secret.
  const config = useRuntimeConfig()
  const previewUrl = `${config.public.siteUrl}/?__theme_id=${id}`

  return { previewUrl }
})
