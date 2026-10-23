import { z } from 'zod'
import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { writeAuditLog } from '../../../../utils/audit'
import { clearActiveThemeCache } from '../../../../utils/theme-cache'
import { waitUntil } from '../../../../utils/cf-env'
import { deleteThemeCSS, deleteThemeDemo, getThemeDemo } from '../../../../utils/cf-theme-kv'
import { getThemeByIdOrThrow } from '../../../../utils/resource-queries'
import { themes, contentItems, menus, forms } from '@nuxflow/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { scopedById } from '../../../../utils/db-helpers'
import type { NuxFlowBackup } from '../../../../utils/backup'
import { purgeAllPublicPages } from '../../../../utils/edge-cache'
import { requireSiteId } from '../../../../utils/site-context'
import { parseQuery } from '../../../../utils/validate'

const querySchema = z.object({
  deleteDemo: z.enum(['true', 'false']).optional().transform(v => v === 'true'),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const id = getRouterParam(event, 'id')!
  const { deleteDemo } = parseQuery(event, querySchema)

  const theme = await getThemeByIdOrThrow(db, siteId, id, 'Theme not found', { id: true, hasCss: true, isActive: true })
  if (!theme.hasCss) throw badRequest('Only CSS themes can be deleted. Bundled themes are removed by redeploying without the package.')

  if (deleteDemo) {
    const demoJson = await getThemeDemo(event, siteId, id)
    // Only a corrupt demo file is skipped (there's nothing to match against). A failed
    // delete must surface: the theme is still there, so the admin can retry.
    let backup: NuxFlowBackup | null = null
    if (demoJson) {
      try {
        backup = JSON.parse(demoJson) as NuxFlowBackup
      } catch (err) {
        console.warn(`[themes] Demo content for theme ${id} is not valid JSON — skipping its removal:`, err)
      }
    }
    if (backup) {
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
    }
  }

  await Promise.all([
    deleteThemeCSS(event, siteId, id),
    deleteThemeDemo(event, siteId, id),
  ])
  await db.delete(themes).where(scopedById(themes.id, id, themes.siteId, siteId))
  await clearActiveThemeCache(event, siteId)

  // Every other path that changes which theme is active purges the edge page cache —
  // deleting the currently-active theme changes it too (to "none"), and without this,
  // cached pages keep serving the deleted theme's now-nonexistent CSS key until TTL
  // expiry. Only worth doing when the deleted theme was actually the active one.
  if (theme.isActive) {
    waitUntil(event, purgeAllPublicPages(event, siteId).catch((err) => {
      console.error('[themes] Failed to purge page cache after theme deletion:', err)
    }))
  }

  await writeAuditLog(event, userId, { action: 'delete', resource: 'theme', resourceId: id, before: theme })

  return noContent(event)
})
