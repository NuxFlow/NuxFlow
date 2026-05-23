import { useDb } from '../utils/db'
import { themes } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { getCfBindings, getThemeCSS } from '../utils/cf-env'

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

    try {
      // We must query the DB here instead of the 'request' hook because 'siteId'
      // is set by the multi-site middleware, which runs AFTER the 'request' hook.
      const db = useDb(event)
      const active = await db.query.themes.findFirst({
        where: and(eq(themes.siteId, siteId), eq(themes.isActive, true)),
        columns: { id: true, hasCss: true },
      })

      if (!active || !active.hasCss) return

      const css = await getThemeCSS(event, siteId, active.id)
      if (css) {
        html.head.push(`<style data-nuxflow-theme>${css}</style>`)
      }
    }
    catch (err) {
      console.error('[nuxflow:theme-resolver] CSS injection failed:', err instanceof Error ? err.message : err)
    }
  })
})
