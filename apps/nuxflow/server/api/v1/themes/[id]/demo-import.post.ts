import { z } from 'zod'
import { requireRole } from '../../../../utils/permissions'
import { waitUntil } from '../../../../utils/cf-env'
import { getThemeDemo } from '../../../../utils/cf-theme-kv'
import { applyBackup } from '../../../../utils/backup'
import { themes } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'
import { scopedById } from '../../../../utils/db-helpers'
import { useDb } from '../../../../utils/db'
import type { NuxFlowBackup } from '../../../../utils/backup'
import { buildAuditLogInsert, batchWithAudit } from '../../../../utils/audit'
import { clearActiveThemeCache } from '../../../../utils/theme-cache'
import { getThemeByIdOrThrow } from '../../../../utils/resource-queries'
import { purgeAllPublicPages } from '../../../../utils/edge-cache'

const bodySchema = z.object({
  what: z.array(z.enum(['content', 'taxonomies', 'menus', 'forms', 'settings'])).default(['content', 'taxonomies', 'menus', 'forms', 'settings']),
  conflictMode: z.enum(['skip', 'overwrite', 'archive']).default('archive'),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const themeId = getRouterParam(event, 'id')!
  const body = await parseBody(event, bodySchema)

  await getThemeByIdOrThrow(db, siteId, themeId)

  const demoJson = await getThemeDemo(event, siteId, themeId)
  if (!demoJson) throw notFound('This theme has no demo content')

  let backup: NuxFlowBackup
  try {
    backup = JSON.parse(demoJson) as NuxFlowBackup
  } catch {
    throw createError({ statusCode: 500, message: 'Demo content is corrupted' })
  }

  const result = await applyBackup(event, siteId, backup, {
    what: body.what,
    conflictMode: body.conflictMode,
  })

  // Automatically activate the theme since we are importing its content
  const deactivateAll = db.update(themes).set({ isActive: false }).where(eq(themes.siteId, siteId))
  const activateTarget = db.update(themes).set({ isActive: true }).where(scopedById(themes.id, themeId, themes.siteId, siteId))

  const auditInsert = buildAuditLogInsert(event, userId, { action: 'activate', resource: 'theme', resourceId: themeId })

  await batchWithAudit(db, [deactivateAll, activateTarget], auditInsert)
  await clearActiveThemeCache(event, siteId)

  // Same as activate.post.ts — theme CSS is baked directly into every cached page's
  // <style> block, so activating a theme as a side effect of a demo import needs the
  // same edge-cache purge every other activation path already does.
  waitUntil(event, purgeAllPublicPages(event, siteId).catch((err) => {
    console.error('[themes] Failed to purge page cache after demo-import activation:', err)
  }))

  return { success: true, result }
})
