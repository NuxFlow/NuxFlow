// How a site looks: its theme CSS and appearance settings. Read by the two render:html
// plugins (theme-resolver.ts, site-settings-resolver.ts), which write them into public
// pages, and by /_nuxflow/editor-styles, which hands the same styling to the Canvas
// editor's frame so the editor shows a page as it looks live.
import type { H3Event } from 'h3'
import { and, eq, inArray } from 'drizzle-orm'
import { siteSettings, themes } from '@nuxflow/db/schema'
import { useDb } from './db'
import { getThemeCSS } from './cf-theme-kv'
import { resolveStringSetting } from './settings'
import { type ActiveTheme, resolveActiveTheme } from './theme-cache'
import { type AppearanceCache, getCachedAppearance, setCachedAppearance } from './appearance-cache'

// ── Theme CSS ─────────────────────────────────────────────────────────────────

export interface SiteThemeCss {
  /** A Customizer theme's base theme — injected first, so the Customizer's choices win. */
  baseCss: string | null
  css: string | null
  isPreview: boolean
}

/**
 * The CSS of the site's active theme (or of `previewId`, a theme of this site an admin
 * asked to preview — never cached, see theme-resolver.ts). Both strings come from
 * getThemeCSS(), which sanitizes them.
 */
export async function loadSiteThemeCss(event: H3Event, siteId: string, previewId?: string | null): Promise<SiteThemeCss> {
  let active: ActiveTheme = null
  let isPreview = false

  if (previewId) {
    const row = await useDb(event).query.themes.findFirst({
      // Re-scoped to siteId: the preview cookie is re-read without re-checking which
      // site it was set for, so a stale or foreign id must find nothing.
      where: and(eq(themes.siteId, siteId), eq(themes.id, previewId)),
      columns: { id: true, hasCss: true, packageName: true, cssVersion: true },
    })
    if (row) {
      active = row
      isPreview = true
    }
  }

  if (!isPreview) {
    // isolate cache -> KV -> D1 (resolveActiveTheme in theme-cache.ts).
    active = await resolveActiveTheme(event, siteId, async () => {
      const row = await useDb(event).query.themes.findFirst({
        where: and(eq(themes.siteId, siteId), eq(themes.isActive, true)),
        columns: { id: true, hasCss: true, packageName: true, cssVersion: true },
      })
      return row ?? null
    })
  }

  if (!active || !active.hasCss) return { baseCss: null, css: null, isPreview }

  // The Customizer's KV entry holds only the rules it generates, never merged with its
  // base theme (see customizer.post.ts), so editing the base theme later shows at once.
  const isCustomizerTheme = active.packageName.startsWith('@customizer/')
  const baseThemeId = isCustomizerTheme ? await resolveStringSetting(event, 'theme.base_theme_id') : null

  const [baseCss, css] = await Promise.all([
    baseThemeId && baseThemeId !== active.id ? getThemeCSS(event, siteId, baseThemeId) : Promise.resolve(null),
    getThemeCSS(event, siteId, active.id, active.cssVersion),
  ])
  return { baseCss, css, isPreview }
}

// ── Appearance settings ───────────────────────────────────────────────────────

/** Google Fonts query strings for the fonts Settings → Appearance offers. */
const SITE_FONT_QUERY: Record<string, string> = {
  'Inter': 'family=Inter:wght@400;500;600;700;800',
  'Geist': 'family=Geist:wght@400;500;600;700;800',
  'Poppins': 'family=Poppins:ital,wght@0,400;0,500;0,600;0,700;0,800',
  'Plus Jakarta Sans': 'family=Plus+Jakarta+Sans:ital,wght@0,400;0,500;0,600;0,700;0,800',
}

/** The site's chosen font when it's one we offer (anything else is ignored). */
export function knownSiteFont(fontSans: string): string | null {
  return fontSans && fontSans !== 'system' && fontSans in SITE_FONT_QUERY ? fontSans : null
}

/** The Google Fonts stylesheet for a font knownSiteFont() accepted. */
export function siteFontHref(font: string): string | null {
  const query = SITE_FONT_QUERY[font]
  return query ? `https://fonts.googleapis.com/css2?${query}&display=swap` : null
}

// Allowlist for colour values written into inline <style> blocks.
const CSS_COLOR_RE = /^(?:#[0-9a-fA-F]{3,8}|rgba?\([\d\s,.]+\)|hsla?\([\d\s,.%]+\)|[a-zA-Z]{2,30})$/

export function safeSiteColor(value: string): string | null {
  return CSS_COLOR_RE.test(value.trim()) ? value.trim() : null
}

export async function loadSiteAppearance(event: H3Event, siteId: string): Promise<AppearanceCache> {
  const cached = getCachedAppearance(siteId)
  if (cached) return cached

  const rows = await useDb(event)
    .select({ key: siteSettings.key, value: siteSettings.value })
    .from(siteSettings)
    .where(and(
      eq(siteSettings.siteId, siteId),
      inArray(siteSettings.key, ['theme.dark_mode', 'theme.primary_color', 'theme.font_sans', 'appearance.custom_head_html', 'appearance.custom_body_html']),
    ))

  const map = Object.fromEntries(rows.map(r => [r.key, String(r.value ?? '')]))
  const entry: AppearanceCache = {
    darkMode: map['theme.dark_mode'] ?? 'auto',
    primaryColor: map['theme.primary_color'] ?? '',
    fontSans: map['theme.font_sans'] ?? 'system',
    customHeadHtml: map['appearance.custom_head_html'] ?? '',
    customBodyHtml: map['appearance.custom_body_html'] ?? '',
  }
  setCachedAppearance(siteId, entry)
  return entry
}

// ── Styling from custom head HTML ─────────────────────────────────────────────

const LINK_TAG_RE = /<link\b[^>]*>/gi
const STYLE_TAG_RE = /<style\b[^>]*>([^<]*(?:<(?!\/style\s*>)[^<]*)*)<\/style\s*>/gi
const ATTR_RE = /([a-z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi

function tagAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (const m of tag.matchAll(ATTR_RE)) attrs[m[1]!.toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? ''
  return attrs
}

/**
 * The styling parts of custom head HTML — https stylesheet links (a theme's web fonts
 * are usually loaded this way) and <style> blocks — and nothing else. Scripts, meta
 * tags and the like never leave here: the editor's frame is same-origin with the admin.
 */
export function stylesFromHeadHtml(html: string): { links: string[]; styles: string[] } {
  const links: string[] = []
  const styles: string[] = []
  if (!html) return { links, styles }

  for (const m of html.matchAll(LINK_TAG_RE)) {
    const attrs = tagAttributes(m[0])
    if (!(attrs.rel ?? '').toLowerCase().split(/\s+/).includes('stylesheet')) continue
    try {
      const url = new URL(attrs.href ?? '')
      if (url.protocol === 'https:') links.push(url.href)
    }
    catch { /* not a URL */ }
  }
  for (const m of html.matchAll(STYLE_TAG_RE)) {
    const css = (m[1] ?? '').trim()
    if (css) styles.push(css)
  }
  return { links, styles }
}

// ── Everything the editor's frame needs ───────────────────────────────────────

export interface EditorSiteStyles {
  /** Stylesheets to link, in order (the site font, then custom head HTML's). */
  links: string[]
  /** CSS to inline, in the order a public page has it. */
  styles: string[]
  darkMode: 'light' | 'dark' | 'auto'
}

export async function loadEditorSiteStyles(event: H3Event, siteId: string): Promise<EditorSiteStyles> {
  const [appearance, theme] = await Promise.all([
    loadSiteAppearance(event, siteId),
    loadSiteThemeCss(event, siteId),
  ])

  const links: string[] = []
  const styles: string[] = []

  // Same order as a public page's <head>: appearance variables, custom head HTML, theme.
  const vars: string[] = []
  const color = appearance.primaryColor ? safeSiteColor(appearance.primaryColor) : null
  if (color) vars.push(`--nuxflow-primary:${color}`)
  const font = knownSiteFont(appearance.fontSans)
  if (font) {
    vars.push(`--nuxflow-font:'${font}',system-ui,-apple-system,sans-serif`)
    const href = siteFontHref(font)
    if (href) links.push(href)
  }
  if (vars.length) {
    styles.push(`:root{${vars.join(';')}}${font ? 'body{font-family:var(--nuxflow-font,system-ui,-apple-system,sans-serif)}' : ''}`)
  }

  const head = stylesFromHeadHtml(appearance.customHeadHtml)
  links.push(...head.links)
  styles.push(...head.styles)

  if (theme.baseCss) styles.push(theme.baseCss)
  if (theme.css) styles.push(theme.css)

  const darkMode = appearance.darkMode === 'dark' || appearance.darkMode === 'light' ? appearance.darkMode : 'auto'
  return { links, styles, darkMode }
}
