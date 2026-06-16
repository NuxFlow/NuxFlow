import { themes } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import { requireRole } from '../../../utils/permissions'
import { resolveSetting, saveSetting } from '../../../utils/settings'
import { putThemeCSS, getThemeCSS } from '../../../utils/cf-env'
import { writeAuditLog } from '../../../utils/audit'
import { useDb } from '../../../utils/db'

interface CustomizerValues {
  colorMode: 'auto' | 'light' | 'dark'
  primaryColor: string
  linkColor: string
  bodyFont: string
  headingFont: string
  fontSize: string
  headingWeight: string
  lineHeight: string
  borderRadius: string
}

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string

  const { values, css } = await readBody<{ values: CustomizerValues; css: string }>(event)
  if (!css?.trim()) throw createError({ statusCode: 400, message: 'css is required' })

  // Persist all values so both the customizer and the themes-page dropdowns stay in sync
  await saveSetting(event, 'theme.customizer_values', JSON.stringify(values))
  await saveSetting(event, 'theme.dark_mode', values.colorMode)
  await saveSetting(event, 'theme.primary_color', values.primaryColor)
  await saveSetting(event, 'theme.font_sans', values.bodyFont !== 'system' ? values.bodyFont : 'system')

  // Find or create the customizer-managed CSS theme
  const storedThemeId = ((await resolveSetting(event, 'theme.customizer_theme_id')) as string) || null
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
  // and uses var(--nuxflow-*) throughout. We combine both so neither is lost:
  //   [customizer vars] + [bundled theme CSS]  →  single KV entry
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

  let baseThemeId: string | null = null

  if (activeTheme && activeTheme.id !== (themeId ?? '__none__')) {
    // A bundled theme (not the customizer theme) is currently active — adopt it as base
    if (activeTheme.hasCss) {
      baseThemeId = activeTheme.id
      await saveSetting(event, 'theme.base_theme_id', baseThemeId)
    }
  }
  else {
    // Customizer is already active (re-publish) — reuse the stored base
    baseThemeId = ((await resolveSetting(event, 'theme.base_theme_id')) as string) || null
  }

  // Fetch the bundled theme CSS and layer it after the customizer variables
  let combinedCss = css.trim()
  if (baseThemeId) {
    const baseCss = await getThemeCSS(event, siteId, baseThemeId)
    if (baseCss?.trim()) {
      combinedCss = css.trim() + '\n\n' + baseCss.trim()
    }
  }

  // Write combined CSS to KV and upsert the DB row
  if (themeId) {
    await putThemeCSS(event, siteId, themeId, combinedCss)
    await db.update(themes)
      .set({ version: new Date().toISOString().slice(0, 10) })
      .where(and(eq(themes.id, themeId), eq(themes.siteId, siteId)))
  }
  else {
    themeId = ulid()
    await putThemeCSS(event, siteId, themeId, combinedCss)
    await db.insert(themes).values({
      id: themeId,
      siteId,
      packageName: `@customizer/theme-${themeId}`,
      name: 'NuxFlow Customizer',
      version: new Date().toISOString().slice(0, 10),
      isActive: false,
      hasCss: true,
    })
    await saveSetting(event, 'theme.customizer_theme_id', themeId)
  }

  // Ensure the customizer theme is active (deactivate all others first)
  await db.update(themes).set({ isActive: false }).where(eq(themes.siteId, siteId))
  await db.update(themes).set({ isActive: true }).where(and(eq(themes.id, themeId!), eq(themes.siteId, siteId)))

  await writeAuditLog(event, userId, { action: 'update', resource: 'theme', resourceId: themeId! })
  return { success: true, themeId }
})
