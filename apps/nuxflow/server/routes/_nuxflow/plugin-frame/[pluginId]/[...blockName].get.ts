import { useDb } from '../../../../utils/db'
import { dynamicPlugins } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

// Serves the document that loads inside each dynamic-plugin block's sandboxed
// <iframe sandbox="allow-scripts"> (see app/components/PluginBlockFrame.vue). This is
// the ONLY place a plugin's src/client.ts ever actually executes — never in the main
// app. Deliberately hand-written HTML, not run through Nuxt SSR: no cookies, no
// session, nothing here that a compromised plugin could reach even if it tried, and
// the sandbox="allow-scripts" attribute on the parent's <iframe> (enforced by the
// browser regardless of anything this response says) additionally strips this
// document's origin down to opaque — no ambient cookies on its own fetches either.
//
// Block ids are `{pluginId}/{blockName}` (see docs/plugins.md) — a catch-all for
// blockName mirrors _nuxflow/ext/[pluginId]/[...path].ts's proven pattern rather than
// trying to pack a "/"-containing id into one URL segment.
export default defineEventHandler(async (event) => {
  const db = useDb(event)
  const siteId = event.context.siteId as string | null
  const pluginId = getRouterParam(event, 'pluginId')!
  const blockName = (getRouterParam(event, 'blockName') ?? '').replace(/^\/+/, '')
  const blockId = `${pluginId}/${blockName}`

  if (!siteId) throw notFound('Unknown site')

  const plugin = await db.query.dynamicPlugins.findFirst({
    where: and(eq(dynamicPlugins.id, pluginId), eq(dynamicPlugins.siteId, siteId)),
    columns: { isActive: true, hasClient: true, blockDefinitions: true },
  })
  if (!plugin || !plugin.isActive || !plugin.hasClient) throw notFound('Plugin block not found')

  const knownBlockIds = new Set((plugin.blockDefinitions as Array<{ id?: string }> | null ?? []).map(b => b.id))
  if (!knownBlockIds.has(blockId)) throw notFound('Block id not declared by this plugin')

  const html = renderPluginFrameHtml(pluginId, blockId)

  setHeader(event, 'content-type', 'text/html; charset=utf-8')
  setHeader(event, 'cache-control', 'no-store')
  // Defense in depth on top of the parent's sandbox="allow-scripts" (which already
  // strips this document's origin to opaque regardless of any header here): restrict
  // this document's own script/connect surface to same-origin, so even a compromised
  // plugin bundle can't smuggle in a second remote script or open arbitrary
  // connections from inside the frame.
  // img-src is deliberately wide open (unlike script/connect) — a block legitimately
  // showing an "image" field's value (site media, which can live on a different
  // origin depending on the configured storage provider) is a normal, low-risk case;
  // image loads can't execute code the way a script or fetch target could.
  // `sandbox allow-scripts` makes the document itself opaque-origin no matter how it's
  // loaded. The embedding <iframe sandbox="allow-scripts"> (PluginBlockFrame.vue) only
  // protects it when it's embedded — this URL is same-origin and can be opened directly
  // as a top-level page (e.g. a link sent to a signed-in admin), where plugin client code
  // would otherwise run with the site's own origin, cookies, and credentialed access to
  // /api/v1. The header version of the sandbox applies in both cases.
  setHeader(event, 'content-security-policy', "sandbox allow-scripts; default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; img-src * data:")
  return html
})

function renderPluginFrameHtml(pluginId: string, blockId: string): string {
  const blockIdJson = JSON.stringify(blockId)
  const bundleUrl = `/_nuxflow/plugin-bundle/${encodeURIComponent(pluginId)}`
  const bundleUrlJson = JSON.stringify(bundleUrl)

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>html,body{margin:0;padding:0}#app{width:100%}</style>
</head>
<body>
<div id="app"></div>
<script type="module">
import * as Vue from '/_nuxflow/vendor/vue-runtime.js'

const blockId = ${blockIdJson}
const propsState = Vue.reactive({})

// Only accept messages from the embedding parent window — this document has no
// other legitimate message source.
window.addEventListener('message', (event) => {
  if (event.source !== window.parent) return
  const data = event.data
  if (data && data.type === 'nuxflow:props' && data.props && typeof data.props === 'object') {
    for (const key of Object.keys(propsState)) delete propsState[key]
    Object.assign(propsState, data.props)
  }
})

function reportHeight(height) {
  window.parent.postMessage({ type: 'nuxflow:resize', height }, '*')
}

function renderFallback(message) {
  const root = document.getElementById('app')
  root.textContent = message
  root.style.cssText = 'padding:16px;color:#991b1b;background:#fef2f2;font:14px system-ui,sans-serif'
}

try {
  const mod = await import(${bundleUrlJson})
  const component = typeof mod.renderBlock === 'function' ? mod.renderBlock(blockId, Vue) : null

  if (!component) {
    renderFallback('Plugin block "' + blockId + '" not found in its client bundle.')
  } else {
    const app = Vue.createApp({
      setup() {
        return () => Vue.h(component, { ...propsState })
      },
    })
    app.config.errorHandler = (err) => {
      console.error('[nuxflow-plugin-frame]', err)
      renderFallback('This block failed to render — see the iframe console for details.')
    }
    app.mount('#app')
  }
} catch (err) {
  console.error('[nuxflow-plugin-frame] failed to load plugin bundle', err)
  renderFallback('This block failed to load.')
}

const ro = new ResizeObserver((entries) => {
  const height = entries[0]?.contentRect?.height
  if (typeof height === 'number') reportHeight(Math.ceil(height))
})
ro.observe(document.getElementById('app'))
// Report an initial height immediately too, in case content never resizes again
// (ResizeObserver's first callback is already async on some browsers).
requestAnimationFrame(() => reportHeight(document.getElementById('app').getBoundingClientRect().height))
</script>
</body>
</html>
`
}
