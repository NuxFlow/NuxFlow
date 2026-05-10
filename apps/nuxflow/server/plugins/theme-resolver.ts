import { useDb } from '../utils/db'
import { themes } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import type { KVNamespace } from '../types/cloudflare-bindings'

export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('request', async (event) => {
    const siteId = event.context.siteId as string | null
    if (!siteId) return

    const db = useDb(event)
    const active = await db.query.themes.findFirst({
      where: and(eq(themes.siteId, siteId), eq(themes.isActive, true)),
      columns: { id: true, packageName: true, settings: true, hasCss: true },
    })

    event.context.theme = active?.packageName ?? '@nuxflow/theme-default'
    event.context.themeSettings = active?.settings ?? {}
    event.context.themeId = active?.id ?? null
    event.context.themeHasCss = active?.hasCss ?? false
  })

  // Inject active CSS theme as an inline <style> block into every SSR page response.
  // Inlining avoids an extra HTTP round-trip and means the correct styles are present
  // on first paint with no flash of the default theme.
  nitro.hooks.hook('render:html', async (html, { event }) => {
    const siteId = event.context.siteId as string | null
    const themeId = event.context.themeId as string | null
    const hasCss = event.context.themeHasCss as boolean

    if (!hasCss || !siteId || !themeId) return

    const kv = event.context.cloudflare?.env?.PLUGIN_KV as KVNamespace | undefined
    if (!kv) return

    const css = await kv.get(`theme:${siteId}:${themeId}:css`)
    if (css) {
      html.head.push(`<style data-nuxflow-theme>${css}</style>`)
    }
  })
})
