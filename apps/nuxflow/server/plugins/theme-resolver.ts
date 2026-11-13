import { getCfBindings } from '../utils/cf-env'
import { loadSiteThemeCss } from '../utils/site-styles'
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
    const siteId = event.context.siteId
    if (!siteId) return

    // Theme CSS is for the public site only — never inject into the admin UI.
    // Admin pages get --nuxflow-primary from site-settings-resolver.ts instead.
    if (getRequestURL(event).pathname.startsWith('/admin')) return

    try {
      // server/middleware/06.theme-preview.ts sets themePreviewId only for an admin (or
      // higher) of THIS site who asked for a preview. A preview always reads the DB and
      // is never cached under the site's key, or every visitor would see it.
      const { baseCss, css, isPreview } = await loadSiteThemeCss(event, siteId, event.context.themePreviewId)

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
