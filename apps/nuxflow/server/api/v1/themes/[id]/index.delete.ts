import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { deleteThemeCSS, deleteThemeDemo, getThemeDemo } from '../../../../utils/cf-env'
import { themes, contentItems, menus, forms } from '@nuxflow/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import type { NuxFlowBackup } from '../../../../utils/backup'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!
  const query = getQuery(event)
  const deleteDemo = query.deleteDemo === 'true'

  const theme = await db.query.themes.findFirst({
    where: and(eq(themes.id, id), eq(themes.siteId, siteId)),
    columns: { id: true, hasCss: true },
  })
  if (!theme) throw createError({ statusCode: 404, message: 'Theme not found' })
  if (!theme.hasCss) throw createError({ statusCode: 400, message: 'Only CSS themes can be deleted. Bundled themes are removed by redeploying without the package.' })

  if (deleteDemo) {
    const demoJson = await getThemeDemo(event, siteId, id)
    if (demoJson) {
      try {
        const backup = JSON.parse(demoJson) as NuxFlowBackup

        // 1. Delete imported pages by slug
        if (backup.content?.length) {
          const slugs = backup.content.map(c => c.slug).filter(Boolean)
          if (slugs.length) {
            await db.delete(contentItems).where(
              and(eq(contentItems.siteId, siteId), inArray(contentItems.slug, slugs))
            )
          }
        }

        // 2. Delete imported menus by name
        if (backup.menus?.length) {
          const names = backup.menus.map(m => m.name).filter(Boolean)
          if (names.length) {
            await db.delete(menus).where(
              and(eq(menus.siteId, siteId), inArray(menus.name, names))
            )
          }
        }

        // 3. Delete imported forms by slug
        if (backup.forms?.length) {
          const slugs = backup.forms.map(f => f.slug).filter(Boolean)
          if (slugs.length) {
            await db.delete(forms).where(
              and(eq(forms.siteId, siteId), inArray(forms.slug, slugs))
            )
          }
        }
      } catch {
        // ignore JSON parse or query execution errors on corrupted demo JSON
      }
    }
  }

  await Promise.all([
    deleteThemeCSS(event, siteId, id),
    deleteThemeDemo(event, siteId, id),
  ])
  await db.delete(themes).where(and(eq(themes.id, id), eq(themes.siteId, siteId)))

  return { success: true }
})
