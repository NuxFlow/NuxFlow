import { themes } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { ulid } from 'ulid'
import { scopedById } from '../../../utils/db-helpers'
import { requireRole } from '../../../utils/permissions'
import { resolveStringSetting, saveSetting } from '../../../utils/settings'
import { waitUntil } from '../../../utils/cf-env'
import { putThemeCSS } from '../../../utils/cf-theme-kv'
import { buildAuditLogInsert, batchWithAudit } from '../../../utils/audit'
import { clearActiveThemeCache } from '../../../utils/theme-cache'
import { useDb } from '../../../utils/db'
import { purgeAllPublicPages } from '../../../utils/edge-cache'
import { requireSiteId } from '../../../utils/site-context'
import { utcDay } from '../../../utils/utc-day'
import { parseBody } from '../../../utils/validate'
import { clearAppearanceCache } from '../../../utils/appearance-cache'
import { CUSTOMIZER_VALUES_KEY } from '../../../utils/theme-customizer'
import { customizerCss, parseCustomizerValues } from '../../../../shared/lib/theme-customizer'

const bodySchema = z.object({
  // Checked field by field by parseCustomizerValues(): an unknown or invalid value takes
  // its default rather than failing the whole publish.
  values: z.record(z.string(), z.unknown()),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = requireSiteId(event)

  const body = await parseBody(event, bodySchema)
  const values = parseCustomizerValues(body.values)
  // Generated here from the checked values — never taken from the browser — with the
  // same function the preview uses, so what's published is what was previewed.
  const ownCss = customizerCss(values)

  // The four values shared with Settings → Appearance live in those settings (the
  // resolver writes them into every page); the rest only in the customizer's theme CSS.
  await saveSetting(event, CUSTOMIZER_VALUES_KEY, values)
  await saveSetting(event, 'theme.dark_mode', values.colorMode)
  await saveSetting(event, 'theme.primary_color', values.primaryColor)
  await saveSetting(event, 'theme.font_sans', values.bodyFont)
  await saveSetting(event, 'theme.font_heading', values.headingFont)
  clearAppearanceCache(siteId)

  // Find or create the customizer-managed CSS theme
  const storedThemeId = ((await resolveStringSetting(event, 'theme.customizer_theme_id'))) || null
  let themeId: string | null = storedThemeId

  if (themeId) {
    const exists = await db.query.themes.findFirst({
      where: and(eq(themes.id, themeId), eq(themes.siteId, siteId), eq(themes.hasCss, true)),
      columns: { id: true },
    })
    if (!exists) themeId = null
  }

  // ── Determine the base bundled theme ────────────────────────────────────────
  // The customizer only generates CSS variables and typography rules. The bundled
  // theme supplies all the visual structure (panel layout, card styles, glows, etc.)
  // and uses var(--nuxflow-*) throughout. Both stay live and separate — the
  // customizer's KV entry holds only its own generated CSS, never the base
  // theme's — and theme-resolver.ts injects them as two separate <style>
  // blocks at render time (base first, customizer overrides second), so
  // editing the base theme later takes effect immediately with no need to
  // re-publish the customizer, and the customizer's choices reliably win the
  // cascade instead of depending on where a merge happened to place them.
  //
  // Base theme tracking:
  //   • If the currently active theme is NOT the customizer theme → that IS the base.
  //     Capture its ID so subsequent re-publishes keep using it even after it's
  //     deactivated by this save.
  //   • If the customizer theme is already active (re-publish) → fall back to the
  //     stored base ID from the previous publish.
  //   • If the user switches bundled themes later and opens the customizer again, the
  //     new bundled theme will be active → base auto-updates on the next publish.

  const activeTheme = await db.query.themes.findFirst({
    where: and(eq(themes.siteId, siteId), eq(themes.isActive, true)),
    columns: { id: true, hasCss: true },
  })

  if (activeTheme && activeTheme.id !== (themeId ?? '__none__')) {
    // A bundled theme (not the customizer theme) is currently active — adopt it as base
    if (activeTheme.hasCss) {
      await saveSetting(event, 'theme.base_theme_id', activeTheme.id)
    }
  }
  // Else: customizer is already active (re-publish) — the stored base setting
  // from the previous publish is left untouched.

  // Write the customizer's own CSS to KV and upsert the DB row
  if (themeId) {
    await putThemeCSS(event, siteId, themeId, ownCss)
    await db.update(themes)
      .set({ version: utcDay() })
      .where(scopedById(themes.id, themeId, themes.siteId, siteId))
  }
  else {
    themeId = ulid()
    await putThemeCSS(event, siteId, themeId, ownCss)
    await db.insert(themes).values({
      id: themeId,
      siteId,
      packageName: `@customizer/theme-${themeId}`,
      name: 'NuxFlow Customizer',
      version: utcDay(),
      isActive: false,
      hasCss: true,
    })
    await saveSetting(event, 'theme.customizer_theme_id', themeId)
  }

  // Ensure the customizer theme is active (deactivate all others first)
  const deactivateAll = db.update(themes).set({ isActive: false }).where(eq(themes.siteId, siteId))
  const activateTarget = db.update(themes).set({ isActive: true }).where(scopedById(themes.id, themeId!, themes.siteId, siteId))

  const auditInsert = buildAuditLogInsert(event, userId, { action: 'update', resource: 'theme', resourceId: themeId! })

  await batchWithAudit(db, [deactivateAll, activateTarget], auditInsert)
  await clearActiveThemeCache(event, siteId)

  // Publishes both new theme CSS and appearance settings (dark mode/primary color/font)
  // directly via saveSetting() above, bypassing settings/index.patch.ts's own purge logic
  // entirely — needs the same full-page purge that route does, for the same reason.
  waitUntil(event, purgeAllPublicPages(event, siteId).catch((err) => {
    console.error('[themes] Failed to purge page cache after customizer publish:', err)
  }))

  return { success: true, themeId, values }
})
