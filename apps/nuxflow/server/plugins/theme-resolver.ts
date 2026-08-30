import { useDb } from '../utils/db'
import { themes } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { getCfBindings, getThemeCSS } from '../utils/cf-env'
import { resolveSetting } from '../utils/settings'
import { type ActiveTheme, getCachedActiveTheme, setCachedActiveTheme } from '../utils/theme-cache'
import { errorMessage } from '../utils/errors'

export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('request', async (event) => {
    // Populate module-level KV cache on every standard incoming request
    getCfBindings(event)
  })

  // Inject active CSS theme as an inline <style> block into every SSR page response.
  // Inlining avoids an extra HTTP round-trip and means the correct styles are present
  // on first paint with no flash of the default theme.
  nitro.hooks.hook('render:html', async (html, { event }) => {
    const siteId = event.context.siteId as string | null
    if (!siteId) return

    // Theme CSS is for the public site only — never inject into the admin UI.
    // Admin pages get --nuxflow-primary from site-settings-resolver.ts instead.
    if (getRequestURL(event).pathname.startsWith('/admin')) return

    try {
      let active: ActiveTheme
      const cached = getCachedActiveTheme(siteId)
      if (cached !== undefined) {
        active = cached
      } else {
        // We must query the DB here instead of the 'request' hook because 'siteId'
        // is set by the multi-site middleware, which runs AFTER the 'request' hook.
        const db = useDb(event)
        const row = await db.query.themes.findFirst({
          where: and(eq(themes.siteId, siteId), eq(themes.isActive, true)),
          columns: { id: true, hasCss: true, packageName: true },
        })
        active = row ?? null
        setCachedActiveTheme(siteId, active)
      }

      if (!active || !active.hasCss) return

      // The Customizer's own KV entry holds only the variables/rules it
      // generates — never merged with the base theme's CSS at publish time
      // (see customizer.post.ts), so the base theme stays live: editing it
      // later is reflected immediately, with no need to re-publish the
      // customizer. Inject the base theme FIRST so the customizer's explicit
      // choices win the cascade over any conflicting default the base theme
      // declares — publishing them pre-merged in the other order used to let
      // a base theme's own `:root` defaults silently outrank the customizer.
      const isCustomizerTheme = active.packageName.startsWith('@customizer/')
      const baseThemeId = isCustomizerTheme
        ? (await resolveSetting(event, 'theme.base_theme_id')) as string | null
        : null

      // getThemeCSS already sanitizes (on write, and on read as a fallback for CSS
      // stored before sanitization existed) and caches the sanitized result — fetch
      // base and active theme CSS in parallel rather than sequentially.
      const [baseCss, css] = await Promise.all([
        baseThemeId && baseThemeId !== active.id ? getThemeCSS(event, siteId, baseThemeId) : Promise.resolve(null),
        getThemeCSS(event, siteId, active.id),
      ])

      if (baseCss) {
        html.head.push(`<style data-nuxflow-theme="base">${baseCss}</style>`)
      }
      if (css) {
        html.head.push(`<style data-nuxflow-theme>${css}</style>`)
      }
    }
    catch (err) {
      console.error('[nuxflow:theme-resolver] CSS injection failed:', errorMessage(err, String(err)))
    }
  })
})
