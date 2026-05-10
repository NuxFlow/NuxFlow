import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { deleteThemeCSS } from '../../../../utils/cf-env'
import { themes } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  const theme = await db.query.themes.findFirst({
    where: and(eq(themes.id, id), eq(themes.siteId, siteId)),
    columns: { id: true, hasCss: true },
  })
  if (!theme) throw createError({ statusCode: 404, message: 'Theme not found' })
  if (!theme.hasCss) throw createError({ statusCode: 400, message: 'Only CSS themes can be deleted. Bundled themes are removed by redeploying without the package.' })

  await deleteThemeCSS(event, siteId, id)
  await db.delete(themes).where(and(eq(themes.id, id), eq(themes.siteId, siteId)))

  return { success: true }
})
