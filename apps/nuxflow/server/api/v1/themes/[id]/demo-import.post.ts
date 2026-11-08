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
import { requireSiteId } from '../../../../utils/site-context'
import { applyDesignSettings } from '../../../../utils/starters/apply'
import { starterSettingKind } from '../../../../../shared/lib/starters'

const bodySchema = z.object({
  // A theme's demo.json can also ship redirect rules (e.g. from an older site's URLs).
  what: z.array(z.enum(['content', 'taxonomies', 'menus', 'forms', 'settings', 'redirects'])).default(['content', 'taxonomies', 'menus', 'forms', 'settings', 'redirects']),
  conflictMode: z.enum(['skip', 'overwrite', 'archive']).default('archive'),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const themeId = getRouterParam(event, 'id')!
  const body = await parseBody(event, bodySchema)

  const theme = await getThemeByIdOrThrow(db, siteId, themeId)

  const demoJson = await getThemeDemo(event, siteId, themeId)
  if (!demoJson) throw notFound('This theme has no demo content')

  let backup: NuxFlowBackup
  try {
    backup = JSON.parse(demoJson) as NuxFlowBackup
  } catch {
    throw httpError({ status: 500, message: 'Demo content is corrupted' })
  }

  // A bundle's design settings (theme.*, frontend.*, layout.*, custom HTML, logo/favicon,
  // SEO title/description/image) follow the starter rules: its look replaces the site's —
  // otherwise "fill only" never changed a site whose Settings had been saved once, since that
  // save writes every field — the owner's logo, SEO wording and custom HTML are kept, and
  // design settings the previous bundle or starter set that this one doesn't are cleared.
  // Everything else (crawler rules, llms.txt, …) is restored as before, by conflictMode.
  const bundleSettings = backup.settings ?? {}
  const designSettings: Record<string, unknown> = {}
  const otherSettings: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(bundleSettings)) {
    if (starterSettingKind(key)) designSettings[key] = value
    else otherSettings[key] = value
  }

  const result = await applyBackup(event, siteId, { ...backup, settings: otherSettings }, {
    what: body.what,
    conflictMode: body.conflictMode,
  })

  let design: { written: number; kept: string[] } = { written: 0, kept: [] }
  if (body.what.includes('settings')) {
    design = await applyDesignSettings(event, siteId, designSettings, {
      id: `theme:${themeId}`,
      name: theme.name,
      version: theme.version,
      source: 'theme',
    })
    result.settings.updated += design.written
  }

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

  return { success: true, result, settingsKept: design.kept }
})
