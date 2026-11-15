import { themes } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { requireRole } from '../../../utils/permissions'
import { resolveSetting, resolveStringSetting } from '../../../utils/settings'
import { useDb } from '../../../utils/db'
import { requireSiteId } from '../../../utils/site-context'
import { CUSTOMIZER_VALUES_KEY, readStoredCustomizerValues } from '../../../utils/theme-customizer'
import { type CustomizerState, parseColorMode, parseCustomizerValues } from '../../../../shared/lib/theme-customizer'

export default defineEventHandler(async (event): Promise<CustomizerState> => {
  await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = requireSiteId(event)

  // The four values shared with Settings → Appearance are read from those settings, so
  // a change made there shows here (and publishing here can't undo it unseen).
  const [stored, darkMode, primaryColor, fontSans, fontHeading, storedThemeId] = await Promise.all([
    resolveSetting(event, CUSTOMIZER_VALUES_KEY),
    resolveStringSetting(event, 'theme.dark_mode'),
    resolveStringSetting(event, 'theme.primary_color'),
    resolveStringSetting(event, 'theme.font_sans'),
    resolveStringSetting(event, 'theme.font_heading'),
    resolveStringSetting(event, 'theme.customizer_theme_id'),
  ])
  const saved = readStoredCustomizerValues(stored)
  const values = parseCustomizerValues({
    ...saved,
    ...(darkMode ? { colorMode: parseColorMode(darkMode) } : {}),
    ...(primaryColor ? { primaryColor } : {}),
    ...(fontSans ? { bodyFont: fontSans } : {}),
    ...(fontHeading ? { headingFont: fontHeading } : {}),
  })

  let customizerThemeId: string | null = null
  if (storedThemeId) {
    const t = await db.query.themes.findFirst({
      where: and(eq(themes.id, storedThemeId), eq(themes.siteId, siteId), eq(themes.hasCss, true)),
      columns: { id: true },
    })
    if (t) customizerThemeId = t.id
  }

  // Applying a starter or activating another theme switches the customizer's theme off;
  // the page says so rather than showing settings that aren't live.
  const active = await db.query.themes.findFirst({
    where: and(eq(themes.siteId, siteId), eq(themes.isActive, true)),
    columns: { id: true, name: true },
  })

  return {
    values,
    customizerThemeId,
    live: !!customizerThemeId && active?.id === customizerThemeId,
    activeThemeName: active && active.id !== customizerThemeId ? active.name : null,
  }
})
