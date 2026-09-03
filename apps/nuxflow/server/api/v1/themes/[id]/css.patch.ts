import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { writeAuditLog } from '../../../../utils/audit'
import { putThemeCSS, waitUntil } from '../../../../utils/cf-env'
import { getThemeByIdOrThrow } from '../../../../utils/resource-queries'
import { themes } from '@nuxflow/db/schema'
import { scopedById } from '../../../../utils/db-helpers'
import { purgeAllPublicPages } from '../../../../utils/edge-cache'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!
  const { css, version } = await readBody<{ css: string; version?: string }>(event)

  if (!css?.trim()) throw badRequest('css is required')

  const theme = await getThemeByIdOrThrow(db, siteId, id, 'Theme not found', { id: true, hasCss: true })
  if (!theme.hasCss) throw badRequest('Only CSS themes can be updated this way')

  await putThemeCSS(event, siteId, id, css.trim())

  if (version?.trim()) {
    await db.update(themes)
      .set({ version: version.trim() })
      .where(scopedById(themes.id, id, themes.siteId, siteId))
  }

  await writeAuditLog(event, userId, { action: 'update_css', resource: 'theme', resourceId: id })

  // Theme CSS is baked directly into every cached page's <style> block. Doesn't check
  // whether this specific theme is the active one — editing an inactive theme's CSS is
  // rare, and the cost of an unnecessary purge is far lower than the cost of a wrong
  // "this theme isn't active, so it's safe" assumption if it turns out to be the active
  // base theme, which isn't tracked via `isActive` at all (see theme.base_theme_id).
  waitUntil(event, purgeAllPublicPages(event, siteId).catch((err) => {
    console.error('[themes] Failed to purge page cache after CSS update:', err)
  }))

  return { success: true }
})
