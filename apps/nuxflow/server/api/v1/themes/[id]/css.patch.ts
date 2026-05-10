import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { putThemeCSS } from '../../../../utils/cf-env'
import { themes } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!
  const { css, version } = await readBody<{ css: string; version?: string }>(event)

  if (!css?.trim()) throw createError({ statusCode: 400, message: 'css is required' })

  const theme = await db.query.themes.findFirst({
    where: and(eq(themes.id, id), eq(themes.siteId, siteId)),
    columns: { id: true, hasCss: true },
  })
  if (!theme) throw createError({ statusCode: 404, message: 'Theme not found' })
  if (!theme.hasCss) throw createError({ statusCode: 400, message: 'Only CSS themes can be updated this way' })

  await putThemeCSS(event, siteId, id, css.trim())

  if (version?.trim()) {
    await db.update(themes)
      .set({ version: version.trim() })
      .where(and(eq(themes.id, id), eq(themes.siteId, siteId)))
  }

  return { success: true }
})
