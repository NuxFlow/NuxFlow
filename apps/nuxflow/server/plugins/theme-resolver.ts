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
      let active: ActiveTheme = null
      let isPreview = false

      // server/middleware/06.theme-preview.ts (which runs well before this
      // render:html hook — it's H3 middleware, executed during request handling,
      // while this hook only fires afterward during SSR rendering) sets this on
      // event.context only for an admin (or higher) of THIS site who explicitly
      // requested a preview. Deliberately bypassed here rather than folded into
      // the activeThemeCache below: that cache is keyed only by siteId and is
      // read by every visitor, so caching a preview under that key would leak
      // one admin's in-progress preview to every other visitor of the site for
      // the rest of the 60s TTL window. A preview lookup always hits the DB.
      const previewId = event.context.themePreviewId as string | undefined
      if (previewId) {
        const db = useDb(event)
        const row = await db.query.themes.findFirst({
          // Re-scoped to siteId here (not just trusting the cookie) because the
          // cookie is re-read as-is on every subsequent request without
          // re-validating site ownership — this guards against a stale/foreign
          // preview id (deleted theme, or a cookie left over from a different
          // site sharing the same browser) silently doing nothing instead of
          // leaking cross-site theme data.
          where: and(eq(themes.siteId, siteId), eq(themes.id, previewId)),
          columns: { id: true, hasCss: true, packageName: true, cssVersion: true },
        })
        if (row) {
          active = row
          isPreview = true
        }
      }

      if (!isPreview) {
        const cached = getCachedActiveTheme(siteId)
        if (cached !== undefined) {
          active = cached
        } else {
          // We must query the DB here instead of the 'request' hook because 'siteId'
          // is set by the multi-site middleware, which runs AFTER the 'request' hook.
          const db = useDb(event)
          const row = await db.query.themes.findFirst({
            where: and(eq(themes.siteId, siteId), eq(themes.isActive, true)),
            columns: { id: true, hasCss: true, packageName: true, cssVersion: true },
          })
          active = row ?? null
          setCachedActiveTheme(siteId, active)
        }
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
        getThemeCSS(event, siteId, active.id, active.cssVersion),
      ])

      if (baseCss) {
        html.head.push(`<style data-nuxflow-theme="base">${baseCss}</style>`)
      }
      if (css) {
        html.head.push(isPreview
          ? `<style data-nuxflow-theme="preview">${css}</style>`
          : `<style data-nuxflow-theme>${css}</style>`)
      }
    }
    catch (err) {
      console.error('[nuxflow:theme-resolver] CSS injection failed:', errorMessage(err, String(err)))
    }
  })
})
