import { useDb } from '../utils/db'
import { siteSettings } from '@nuxflow/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import type { H3Event } from 'h3'

// ── Per-isolate cache ─────────────────────────────────────────────────────────
// Stores resolved appearance settings per site so we don't hit the DB on every
// SSR render. TTL of 60 s is a good tradeoff: changes are reflected within a
// minute without adding a DB round-trip to every page load.

interface AppearanceCache {
  darkMode: string
  primaryColor: string
  fontSans: string
  customHeadHtml: string
  customBodyHtml: string
  ts: number
}

const _cache = new Map<string, AppearanceCache>()
const CACHE_TTL = 60_000

export function clearAppearanceCache(siteId: string): void {
  _cache.delete(siteId)
}

// ── Sanitization ─────────────────────────────────────────────────────────────

// Allowlist for CSS color values written into inline <style> blocks.
// Rejects anything that could break out of the CSS context.
const CSS_COLOR_RE = /^(?:#[0-9a-fA-F]{3,8}|rgba?\([\d\s,.]+\)|hsla?\([\d\s,.%]+\)|[a-zA-Z]{2,30})$/

function safeCssColor(value: string): string | null {
  return CSS_COLOR_RE.test(value.trim()) ? value.trim() : null
}

// ── Google Fonts query strings ────────────────────────────────────────────────

const FONT_QUERY: Record<string, string> = {
  'Inter': 'family=Inter:wght@400;500;600;700;800',
  'Geist': 'family=Geist:wght@400;500;600;700;800',
  'Poppins': 'family=Poppins:ital,wght@0,400;0,500;0,600;0,700;0,800',
  'Plus Jakarta Sans': 'family=Plus+Jakarta+Sans:ital,wght@0,400;0,500;0,600;0,700;0,800',
}

async function resolveAppearance(event: H3Event, siteId: string): Promise<AppearanceCache> {
  const now = Date.now()
  const cached = _cache.get(siteId)
  if (cached && now - cached.ts < CACHE_TTL) return cached

  const db = useDb(event)
  const rows = await db
    .select({ key: siteSettings.key, value: siteSettings.value })
    .from(siteSettings)
    .where(
      and(
        eq(siteSettings.siteId, siteId),
        inArray(siteSettings.key, ['theme.dark_mode', 'theme.primary_color', 'theme.font_sans', 'appearance.custom_head_html', 'appearance.custom_body_html']),
      ),
    )

  const map = Object.fromEntries(rows.map(r => [r.key, String(r.value ?? '')]))
  const entry: AppearanceCache = {
    darkMode: map['theme.dark_mode'] ?? 'auto',
    primaryColor: map['theme.primary_color'] ?? '',
    fontSans: map['theme.font_sans'] ?? 'system',
    customHeadHtml: map['appearance.custom_head_html'] ?? '',
    customBodyHtml: map['appearance.custom_body_html'] ?? '',
    ts: now,
  }
  _cache.set(siteId, entry)
  return entry
}

// ── Plugin ────────────────────────────────────────────────────────────────────

export default defineNitroPlugin((nitro) => {
  // Inject appearance settings into every SSR page response:
  //   • dark_mode  → blocking <script> that adds/removes the "dark" class before
  //                  paint, preventing a flash of wrong colour scheme
  //   • primary_color → --nuxflow-primary CSS custom property
  //   • font_sans  → --nuxflow-font custom property + Google Fonts <link>
  //
  // Admin pages (/admin/*) skip the dark-mode and font injections because the
  // admin has its own colour-mode toggle and Nuxt UI handles its font.
  // The --nuxflow-primary variable IS injected everywhere so .nav-active and
  // custom CSS in the admin can reference it.
  nitro.hooks.hook('render:html', async (html, { event }) => {
    const siteId = event.context.siteId as string | null
    if (!siteId) return

    try {
      const { darkMode, primaryColor, fontSans, customHeadHtml, customBodyHtml } = await resolveAppearance(event, siteId)

      const path = getRequestURL(event).pathname
      const isAdmin = path.startsWith('/admin')

      const cssParts: string[] = []

      // Primary colour custom property — validate before injecting into <style>
      const safeColor = primaryColor ? safeCssColor(primaryColor) : null
      if (safeColor) {
        cssParts.push(`--nuxflow-primary:${safeColor}`)
      }

      if (!isAdmin) {
        // ── Dark mode ──────────────────────────────────────────────────────────
        // Use a blocking inline script so the class is set before any CSS or
        // Vue hydration runs, avoiding a flash of the wrong mode.
        if (darkMode === 'dark') {
          html.head.unshift(`<script>document.documentElement.classList.add('dark')</script>`)
        }
        else if (darkMode === 'light') {
          html.head.unshift(`<script>document.documentElement.classList.remove('dark')</script>`)
        }
        // 'auto' → do nothing; @nuxtjs/color-mode / system preference handles it

        // ── Font — only inject from the known allowlist ────────────────────────
        const knownFont = (fontSans && fontSans !== 'system' && fontSans in FONT_QUERY) ? fontSans : null
        if (knownFont) {
          cssParts.push(`--nuxflow-font:'${knownFont}',system-ui,-apple-system,sans-serif`)

          const query = FONT_QUERY[knownFont]
          if (query) {
            html.head.push(`<link rel="preconnect" href="https://fonts.googleapis.com">`)
            html.head.push(`<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="">`)
            html.head.push(`<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${query}&display=swap">`)
          }
        }
      }

      if (cssParts.length) {
        // Apply --nuxflow-font to body on public pages so all text picks it up
        const knownFontForBody = (fontSans && fontSans !== 'system' && fontSans in FONT_QUERY) ? fontSans : null
        const bodyRule = (!isAdmin && knownFontForBody)
          ? `body{font-family:var(--nuxflow-font,system-ui,-apple-system,sans-serif)}`
          : ''
        html.head.push(
          `<style data-nuxflow-appearance>:root{${cssParts.join(';')}}${bodyRule}</style>`,
        )
      }

      // Custom code injection — admin-only setting; only injected on public pages
      if (!isAdmin) {
        if (customHeadHtml) html.head.push(customHeadHtml)
        if (customBodyHtml) html.bodyAppend.push(customBodyHtml)
      }
    }
    catch (err) {
      console.error('[nuxflow:site-settings-resolver] Failed:', err instanceof Error ? err.message : err)
    }
  })
})
