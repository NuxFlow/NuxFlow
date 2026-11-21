// The Visual Customizer and the site's appearance settings, turned into CSS. Import-free:
// the server writes this CSS into public pages and the Canvas editor's frame, and the
// customizer's live preview uses the very same functions, so the preview can't drift
// from what publishing produces.
//
// Two layers, kept apart on purpose:
//   • appearanceCss() — the four values shared with Settings → Appearance (colour mode,
//     accent colour, body font, heading font). Stored as plain `theme.*` site settings and
//     written into every public page by server/plugins/site-settings-resolver.ts.
//   • customizerCss() — everything else the customizer offers. Stored as the customizer's
//     own theme CSS (server/api/v1/themes/customizer.post.ts), layered over a base theme.
//
// Every rule targets something the public site really renders: Nuxt UI's palette and
// radius variables (every block's `primary-*` and `rounded-*` classes read them), the
// `.mesh-bg` layout wrapper, `.nux-content` (posts), `.prose` (Canvas text blocks),
// `.nux-article` (the post/page reading column) and `--nuxflow-spacing-scale`, which
// @nuxflow/canvas's spacingToCss() multiplies into every block's vertical padding.
// Only values that differ from the default produce a rule, so publishing untouched
// defaults leaves the base theme exactly as it was.

// ── Fonts ─────────────────────────────────────────────────────────────────────

export interface SiteFont {
  value: string
  group: 'Sans-serif' | 'Serif' | 'Monospace'
  stack: string
  /** Google Fonts css2 `family=` query. */
  query: string
}

export const SITE_FONTS: readonly SiteFont[] = [
  { value: 'Inter', group: 'Sans-serif', stack: '\'Inter\',system-ui,sans-serif', query: 'family=Inter:wght@300;400;500;600;700;800' },
  { value: 'Geist', group: 'Sans-serif', stack: '\'Geist\',system-ui,sans-serif', query: 'family=Geist:wght@300;400;500;600;700;800' },
  { value: 'DM Sans', group: 'Sans-serif', stack: '\'DM Sans\',system-ui,sans-serif', query: 'family=DM+Sans:ital,opsz,wght@0,9..40,300..800;1,9..40,300..800' },
  { value: 'Outfit', group: 'Sans-serif', stack: '\'Outfit\',system-ui,sans-serif', query: 'family=Outfit:wght@300;400;500;600;700;800' },
  { value: 'Plus Jakarta Sans', group: 'Sans-serif', stack: '\'Plus Jakarta Sans\',system-ui,sans-serif', query: 'family=Plus+Jakarta+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800' },
  { value: 'Nunito', group: 'Sans-serif', stack: '\'Nunito\',system-ui,sans-serif', query: 'family=Nunito:ital,wght@0,300;0,400;0,600;0,700;0,800;1,400' },
  { value: 'Poppins', group: 'Sans-serif', stack: '\'Poppins\',system-ui,sans-serif', query: 'family=Poppins:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800' },
  { value: 'Raleway', group: 'Sans-serif', stack: '\'Raleway\',system-ui,sans-serif', query: 'family=Raleway:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800' },
  { value: 'Open Sans', group: 'Sans-serif', stack: '\'Open Sans\',system-ui,sans-serif', query: 'family=Open+Sans:ital,wght@0,300;0,400;0,600;0,700;0,800;1,300' },
  { value: 'Work Sans', group: 'Sans-serif', stack: '\'Work Sans\',system-ui,sans-serif', query: 'family=Work+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700' },
  { value: 'Lora', group: 'Serif', stack: '\'Lora\',Georgia,serif', query: 'family=Lora:ital,wght@0,400;0,600;0,700;1,400;1,600' },
  { value: 'Merriweather', group: 'Serif', stack: '\'Merriweather\',Georgia,serif', query: 'family=Merriweather:ital,wght@0,300;0,400;0,700;1,300;1,400' },
  { value: 'Playfair Display', group: 'Serif', stack: '\'Playfair Display\',Georgia,serif', query: 'family=Playfair+Display:ital,wght@0,400;0,600;0,700;0,800;1,400' },
  { value: 'EB Garamond', group: 'Serif', stack: '\'EB Garamond\',Georgia,serif', query: 'family=EB+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400' },
  { value: 'JetBrains Mono', group: 'Monospace', stack: '\'JetBrains Mono\',monospace', query: 'family=JetBrains+Mono:ital,wght@0,300;0,400;0,500;0,700;1,400' },
  { value: 'Fira Code', group: 'Monospace', stack: '\'Fira Code\',monospace', query: 'family=Fira+Code:wght@300;400;500;600;700' },
]

export const SYSTEM_FONT_STACK = 'system-ui,-apple-system,BlinkMacSystemFont,sans-serif'

/** The font when it's one we offer; 'system' and anything unknown give null. */
export function siteFont(name: string | null | undefined): SiteFont | null {
  return SITE_FONTS.find(f => f.value === name) ?? null
}

/**
 * One Google Fonts stylesheet for every offered font in `names` (unknown names and
 * 'system'/'same' are skipped), or null when none needs loading. Loaded with a <link>,
 * never `@import`: the theme-CSS sanitizer strips `@import`, which is why fonts chosen
 * in the customizer used to show in its preview and vanish once published.
 */
export function siteFontsHref(names: readonly (string | null | undefined)[]): string | null {
  const queries = [...new Set(names.map(n => siteFont(n)?.query).filter((q): q is string => !!q))]
  return queries.length ? `https://fonts.googleapis.com/css2?${queries.join('&')}&display=swap` : null
}

// ── Colours ───────────────────────────────────────────────────────────────────

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i
// Allowlist for colour values written into inline <style> blocks (Settings → Appearance
// has always accepted these forms for the accent colour).
const CSS_COLOR_RE = /^(?:#[0-9a-f]{3,8}|rgba?\([\d\s,.]+\)|hsla?\([\d\s,.%]+\)|[a-z]{2,30})$/i

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_RE.test(value)
}

/** The colour, trimmed, when it's safe to write into CSS; otherwise null. */
export function safeCssColor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim()
  return CSS_COLOR_RE.test(v) ? v : null
}

// ── Readable text on a colour ─────────────────────────────────────────────────

/** The dark text colour used on light accents (Tailwind slate-900, as the Button block's default). */
export const DARK_ON_ACCENT = '#0f172a'

function relativeLuminance(hex: string): number {
  const h = hex.replace('#', '')
  const full = h.length <= 4 ? [...h.slice(0, 3)].map(c => c + c).join('') : h.slice(0, 6)
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = Number.parseInt(full.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

/** WCAG contrast ratio between two hex colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * White or dark text, whichever reads better on `background` (a hex colour). The better of
 * the two is always well above WCAG's 3:1 for buttons, whatever the colour. Non-hex input
 * (a CSS keyword, rgb()) gets white.
 */
export function readableTextOn(background: string): string {
  if (!isHexColor(background)) return '#ffffff'
  return contrastRatio(background, '#ffffff') >= contrastRatio(background, DARK_ON_ACCENT) ? '#ffffff' : DARK_ON_ACCENT
}

/**
 * Every public page (and the editor frame) carries this, accent chosen or not: Nuxt UI's
 * solid buttons and badges (`bg-primary text-inverted`) put white text on the accent in
 * light mode, which on the usual greens was about 2:1. They now use
 * --nuxflow-on-primary, or dark text when no accent is chosen (Nuxt UI's own green).
 * Dark mode already pairs a lighter accent with dark text. Kept out of appearanceCss() so
 * a site's defaults still write no appearance rules.
 */
export const ON_PRIMARY_BUTTON_CSS = ':root:not(.dark) .bg-primary.text-inverted{color:var(--nuxflow-on-primary,#0f172a)}'

/** Contrast normal-size text needs on its background (WCAG AA). */
const TEXT_CONTRAST = 4.5

/**
 * The accent as text on white: the accent itself when it already reads at 4.5:1, otherwise
 * the same colour darkened (mixed with black, in 5% steps) just until it does.
 */
export function readableAccentText(hex: string): string {
  if (!isHexColor(hex)) return hex
  const h = hex.replace('#', '')
  const full = h.length <= 4 ? [...h.slice(0, 3)].map(c => c + c).join('') : h.slice(0, 6)
  const rgb = [0, 2, 4].map(i => Number.parseInt(full.slice(i, i + 2), 16))
  const toHex = (f: number) => `#${rgb.map(c => Math.round(c * f).toString(16).padStart(2, '0')).join('')}`
  for (let f = 1; f > 0; f -= 0.05) {
    const candidate = toHex(f)
    if (contrastRatio(candidate, '#ffffff') >= TEXT_CONTRAST) return f === 1 ? hex.toLowerCase() : candidate
  }
  return '#000000'
}

// Accent-coloured text on the light page: Nuxt UI's `text-primary` and the blocks'
// text-primary-400…700. Light mode only (dark mode puts light text on dark backgrounds).
const ACCENT_TEXT_SELECTOR = ':root:not(.dark) :is(.text-primary,.text-primary-400,.text-primary-500,.text-primary-600,.text-primary-700)'

/**
 * Keeps accent-coloured text readable on white, for every public page and the editor
 * frame: '' when the accent already reads at 4.5:1 (nothing changes); for a light accent,
 * the darker version from readableAccentText(); with no accent chosen, Nuxt UI's own
 * darker shade (its green, or a theme's palette).
 */
export function accentTextCss(accent: string | null | undefined): string {
  if (!accent || !isHexColor(accent)) return `${ACCENT_TEXT_SELECTOR}{color:var(--ui-color-primary-700)}`
  const text = readableAccentText(accent)
  return text === accent.toLowerCase() ? '' : `${ACCENT_TEXT_SELECTOR}{color:${text}}`
}

/** Everything that keeps accent colours readable, for a site with this accent (or none). */
export function accentReadabilityCss(accent: string | null | undefined): string {
  return `${ON_PRIMARY_BUTTON_CSS}${accentTextCss(accent)}`
}

// Nuxt UI's shades as mixes of the chosen colour with white (lighter) or black (darker).
// Every block's `text-primary-500`, `bg-primary-600`… resolves to --ui-color-primary-*,
// which Nuxt UI declares in `@layer theme`, so these unlayered declarations win.
const SHADE_MIX: readonly [shade: number, percent: number, mixWith: 'white' | 'black'][] = [
  [50, 8, 'white'], [100, 16, 'white'], [200, 32, 'white'], [300, 52, 'white'], [400, 76, 'white'],
  [500, 100, 'white'], [600, 84, 'black'], [700, 68, 'black'], [800, 54, 'black'], [900, 42, 'black'], [950, 28, 'black'],
]

/** CSS declarations that recolour Nuxt UI's primary palette from one colour. */
export function primaryPaletteDeclarations(color: string): string[] {
  return SHADE_MIX.map(([shade, percent, mixWith]) => percent === 100
    ? `--ui-color-primary-${shade}:${color}`
    : `--ui-color-primary-${shade}:color-mix(in oklab,${color} ${percent}%,${mixWith})`)
}

// ── Shared appearance (Settings → Appearance and the customizer) ──────────────

export type ColorMode = 'auto' | 'light' | 'dark'

export function parseColorMode(value: unknown): ColorMode {
  return value === 'light' || value === 'dark' ? value : 'auto'
}

export interface AppearanceValues {
  primaryColor: string
  /** A SITE_FONTS value, or 'system'. */
  bodyFont: string
  /** A SITE_FONTS value, 'system', or 'same' (headings use the body font). */
  headingFont: string
}

/**
 * The CSS for a public page's appearance settings. The accent colour becomes
 * --nuxflow-primary (for theme CSS) and Nuxt UI's palette (for the blocks); the fonts
 * become --nuxflow-font / --nuxflow-heading-font and Tailwind's --font-sans.
 * Load the fonts themselves with siteFontsHref().
 */
export function appearanceCss(a: AppearanceValues): string {
  const root: string[] = []
  const rules: string[] = []

  const color = safeCssColor(a.primaryColor)
  // --nuxflow-on-primary: the text colour for anything filled with the accent (primary-500)
  // — the Calendar, Class passes, Product and Gallery buttons. Unset (no accent chosen),
  // they fall back to dark text, which suits Nuxt UI's default green.
  if (color) root.push(`--nuxflow-primary:${color}`, `--nuxflow-on-primary:${readableTextOn(color)}`, ...primaryPaletteDeclarations(color))

  const body = siteFont(a.bodyFont)
  if (body) {
    root.push(`--nuxflow-font:${body.stack}`, '--font-sans:var(--nuxflow-font)')
    rules.push('body{font-family:var(--nuxflow-font)}')
  }

  if (a.headingFont !== 'same') {
    const heading = siteFont(a.headingFont)
    const stack = heading ? heading.stack : SYSTEM_FONT_STACK
    // 'system' with a system body font changes nothing, so leaves no rule.
    if (heading || body) {
      root.push(`--nuxflow-heading-font:${stack}`)
      rules.push('h1,h2,h3,h4,h5,h6{font-family:var(--nuxflow-heading-font)}')
    }
  }

  return [root.length ? `:root{${root.join(';')}}` : '', ...rules].join('')
}

// ── The customizer's own values ───────────────────────────────────────────────

export const FONT_SIZES = { xs: '0.875rem', sm: '0.9375rem', base: '', lg: '1.0625rem', xl: '1.125rem' } as const
export const LINE_HEIGHTS = { tight: '1.45', normal: '', relaxed: '1.9' } as const
/** Nuxt UI's --ui-radius; Tailwind's rounded-sm…3xl are multiples of it (md = its default). */
export const RADII = { none: '0rem', sm: '0.125rem', md: '', lg: '0.375rem', xl: '0.5rem' } as const
export const SPACING_SCALES = { compact: '0.6', normal: '', spacious: '1.5' } as const
/** Max width of `.nux-article`, the reading column of posts and text pages (default 56rem). */
export const ARTICLE_WIDTHS = { narrow: '42rem', default: '', wide: '72rem' } as const
export const HEADING_WEIGHTS = ['', '300', '400', '500', '600', '700', '800'] as const

export interface CustomizerValues extends AppearanceValues {
  colorMode: ColorMode
  /** '' = as the theme colours links. */
  linkColor: string
  /** '' = the theme's own background. */
  bgLight: string
  bgDark: string
  fontSize: keyof typeof FONT_SIZES
  /** '' = as the theme draws them. */
  headingWeight: typeof HEADING_WEIGHTS[number]
  lineHeight: keyof typeof LINE_HEIGHTS
  borderRadius: keyof typeof RADII
  spacing: keyof typeof SPACING_SCALES
  contentWidth: keyof typeof ARTICLE_WIDTHS
}

export const CUSTOMIZER_DEFAULTS: CustomizerValues = {
  colorMode: 'auto',
  primaryColor: '#00dc82',
  linkColor: '',
  bgLight: '',
  bgDark: '',
  bodyFont: 'system',
  headingFont: 'same',
  fontSize: 'base',
  headingWeight: '',
  lineHeight: 'normal',
  borderRadius: 'md',
  spacing: 'normal',
  contentWidth: 'default',
}

/** GET /api/v1/themes/customizer. */
export interface CustomizerState {
  values: CustomizerValues
  /** The customizer's own theme, once published. */
  customizerThemeId: string | null
  /** The customizer's theme is the active theme. */
  live: boolean
  /** The theme that's active instead of the customizer's, if any. */
  activeThemeName: string | null
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T : fallback
}

function fontName(value: unknown, extra: readonly string[], fallback: string): string {
  if (typeof value !== 'string') return fallback
  return extra.includes(value) || siteFont(value) ? value : fallback
}

/**
 * Customizer values from anything (a request body, a stored setting), field by field:
 * a missing or invalid field takes its default. Values from older versions map across
 * ('full' radius → 'xl', 'full' width → 'wide').
 */
export function parseCustomizerValues(raw: unknown): CustomizerValues {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const d = CUSTOMIZER_DEFAULTS
  const optionalHex = (v: unknown) => (isHexColor(v) ? v.toLowerCase() : '')
  return {
    colorMode: parseColorMode(r.colorMode),
    primaryColor: isHexColor(r.primaryColor) ? r.primaryColor.toLowerCase() : d.primaryColor,
    linkColor: optionalHex(r.linkColor),
    bgLight: optionalHex(r.bgLight),
    bgDark: optionalHex(r.bgDark),
    bodyFont: fontName(r.bodyFont, ['system'], d.bodyFont),
    headingFont: fontName(r.headingFont, ['same', 'system'], d.headingFont),
    fontSize: pick(r.fontSize, Object.keys(FONT_SIZES) as (keyof typeof FONT_SIZES)[], d.fontSize),
    headingWeight: pick(r.headingWeight, HEADING_WEIGHTS, d.headingWeight),
    lineHeight: pick(r.lineHeight, Object.keys(LINE_HEIGHTS) as (keyof typeof LINE_HEIGHTS)[], d.lineHeight),
    borderRadius: r.borderRadius === 'full' ? 'xl' : pick(r.borderRadius, Object.keys(RADII) as (keyof typeof RADII)[], d.borderRadius),
    spacing: pick(r.spacing, Object.keys(SPACING_SCALES) as (keyof typeof SPACING_SCALES)[], d.spacing),
    contentWidth: r.contentWidth === 'full' ? 'wide' : pick(r.contentWidth, Object.keys(ARTICLE_WIDTHS) as (keyof typeof ARTICLE_WIDTHS)[], d.contentWidth),
  }
}

const HEADINGS = 'h1,h2,h3,h4,h5,h6'
const PROSE_HEADINGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].flatMap(h => [`.nux-content ${h}`, `.prose ${h}`]).join(',')

/**
 * The customizer's own theme CSS (everything but the shared appearance values, which
 * appearanceCss() covers). Expects values from parseCustomizerValues().
 */
export function customizerCss(v: CustomizerValues): string {
  const root: string[] = []
  const out: string[] = ['/* NuxFlow Visual Customizer */']

  const radius = RADII[v.borderRadius]
  if (radius) {
    root.push(`--ui-radius:${radius}`)
    // Post content's images, quotes and code blocks have their own fixed radius in
    // main.css; follow the same scale (rounded-lg).
    out.push(`.nux-content img,.nux-content pre,.nux-content blockquote{border-radius:calc(var(--ui-radius) * 2)}`)
  }

  const scale = SPACING_SCALES[v.spacing]
  if (scale) root.push(`--nuxflow-spacing-scale:${scale}`)

  if (v.linkColor) {
    root.push(`--nuxflow-link:${v.linkColor}`)
    // Posts (.nux-content) and Canvas text blocks (.prose, Tailwind Typography's vars).
    out.push('.nux-content a,.dark .nux-content a{color:var(--nuxflow-link)}')
    out.push('.prose{--tw-prose-links:var(--nuxflow-link);--tw-prose-invert-links:var(--nuxflow-link)}')
  }

  if (root.length) out.splice(1, 0, `:root{${root.join(';')}}`)

  // The layout paints the page on .mesh-bg (body is transparent), see main.css.
  if (v.bgLight) out.push(`.mesh-bg{background-color:${v.bgLight}}`)
  if (v.bgDark) out.push(`.dark .mesh-bg,.mesh-bg.dark{background-color:${v.bgDark}}`)

  const size = FONT_SIZES[v.fontSize]
  const lineHeight = LINE_HEIGHTS[v.lineHeight]
  if (size || lineHeight) {
    const decl = [size && `font-size:${size}`, lineHeight && `line-height:${lineHeight}`].filter(Boolean).join(';')
    out.push(`body,.nux-content,.prose{${decl}}`)
  }

  if (v.headingWeight) out.push(`${HEADINGS},${PROSE_HEADINGS}{font-weight:${v.headingWeight}}`)

  const width = ARTICLE_WIDTHS[v.contentWidth]
  if (width) out.push(`.nux-article{max-width:${width}}`)

  return out.join('\n')
}
