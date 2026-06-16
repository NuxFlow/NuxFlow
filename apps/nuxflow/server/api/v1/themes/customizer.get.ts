import { themes } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { requireRole } from '../../../utils/permissions'
import { resolveSetting } from '../../../utils/settings'
import { useDb } from '../../../utils/db'

interface CustomizerValues {
  colorMode: 'auto' | 'light' | 'dark'
  primaryColor: string
  linkColor: string
  bgLight: string
  bgDark: string
  bodyFont: string
  headingFont: string
  fontSize: 'xs' | 'sm' | 'base' | 'lg' | 'xl'
  headingWeight: '300' | '400' | '500' | '600' | '700' | '800'
  lineHeight: 'tight' | 'normal' | 'relaxed'
  borderRadius: 'none' | 'sm' | 'md' | 'lg' | 'xl' | 'full'
  spacing: 'compact' | 'normal' | 'spacious'
  contentWidth: 'narrow' | 'default' | 'wide' | 'full'
}

const DEFAULTS: CustomizerValues = {
  colorMode: 'auto',
  primaryColor: '#00dc82',
  linkColor: '',
  bgLight: '',
  bgDark: '',
  bodyFont: 'system',
  headingFont: 'same',
  fontSize: 'base',
  headingWeight: '700',
  lineHeight: 'normal',
  borderRadius: 'md',
  spacing: 'normal',
  contentWidth: 'default',
}

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string

  // Try to load saved customizer values
  const storedJson = await resolveSetting(event, 'theme.customizer_values')
  let values: CustomizerValues = { ...DEFAULTS }

  if (storedJson) {
    try {
      values = { ...DEFAULTS, ...JSON.parse(storedJson as string) }
    } catch { /* use defaults on malformed JSON */ }
  } else {
    // First visit — migrate from existing 3-knob appearance settings
    const darkMode = ((await resolveSetting(event, 'theme.dark_mode')) as string) || 'auto'
    const primaryColor = ((await resolveSetting(event, 'theme.primary_color')) as string) || '#00dc82'
    const fontSans = ((await resolveSetting(event, 'theme.font_sans')) as string) || 'system'
    values = {
      ...DEFAULTS,
      colorMode: darkMode as CustomizerValues['colorMode'],
      primaryColor,
      bodyFont: fontSans,
    }
  }

  // Resolve the ID of the theme that the customizer manages
  const storedThemeId = ((await resolveSetting(event, 'theme.customizer_theme_id')) as string) || null
  let customizerThemeId: string | null = null

  if (storedThemeId) {
    const t = await db.query.themes.findFirst({
      where: and(eq(themes.id, storedThemeId), eq(themes.siteId, siteId), eq(themes.hasCss, true)),
      columns: { id: true },
    })
    if (t) customizerThemeId = t.id
  }

  return { values, customizerThemeId }
})
