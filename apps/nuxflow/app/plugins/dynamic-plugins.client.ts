// Registers every active dynamic plugin's Canvas blocks at app boot. Unlike the old
// implementation, no plugin JavaScript ever executes here or anywhere else in the
// main app — src/client.ts only ever runs inside the sandboxed iframe
// PluginBlockFrame.vue embeds (see _nuxflow/plugin-frame/[pluginId]/[...blockName].get.ts).
// This file only reads block metadata (id/name/icon/fields/defaultProps — plain JSON,
// never executed) from the public plugin listing and registers a generic sandboxed
// renderer for each declared block id.
import PluginBlockFrame from '../components/PluginBlockFrame.vue'

interface PublicDynamicPlugin {
  id: string
  isActive: boolean
  hasClient: boolean
  blockDefinitions: Array<{ id: string; name: string; icon?: string; description?: string } & Record<string, unknown>>
}

export default defineNuxtPlugin(async () => {
  // Perf: skip the plugin-listing fetch entirely on the common plugin-free site. app.vue
  // fetches GET /api/public/site (key: 'nuxflow-public-site') for header/footer chrome on
  // every page load regardless, and that response now carries a `hasPlugins` flag — see
  // site.get.ts — computed from the exact same `isActive && hasClient` condition this file
  // filters on below. Plugins execute before the root component's own <script setup> runs,
  // so app.vue's fetch hasn't necessarily *started* yet at this point — but with `ssr: true`
  // (always on, per nuxt.config.ts) the initial render is always server-rendered first, and
  // Nuxt hydrates the payload cache (window.__NUXT__ → nuxtApp.payload.data) *before* running
  // any client plugins. So `useNuxtData` here is a synchronous read of already-resolved SSR
  // data, not a race against app.vue's own fetch.
  //
  // `hasPlugins === false` is trusted to skip; anything else (`true`, or `undefined` when
  // the cached entry isn't there — e.g. a test harness, or app.vue's own fetch having
  // failed) falls through to the original fetch-and-filter below, so this can only ever
  // cause an extra harmless fetch, never a missed one.
  const cachedSite = useNuxtData<{ hasPlugins?: boolean }>('nuxflow-public-site')
  if (cachedSite.data.value?.hasPlugins === false) return

  let plugins: PublicDynamicPlugin[]
  try {
    const res = await $fetch<{ plugins: PublicDynamicPlugin[] }>('/api/public/dynamic-plugins')
    plugins = res.plugins.filter(p => p.isActive && p.hasClient)
  } catch {
    return
  }

  // Defensive fallback kept even with the skip above — a stale/wrong `hasPlugins: true`
  // (or a cache miss that fell through to this fetch) must still resolve correctly here.
  if (plugins.length === 0) return

  const registry = useBlockRegistry()

  for (const plugin of plugins) {
    for (const def of plugin.blockDefinitions) {
      if (!def.id) continue

      // One small wrapper per block id, closing over its fixed pluginId/blockType so
      // PluginBlockFrame knows which iframe to point at — every other prop (the
      // block's own field values) is forwarded straight through via $attrs.
      const component = defineComponent({
        name: `PluginBlock_${def.id}`,
        inheritAttrs: false,
        setup(_props, { attrs }) {
          return () => h(PluginBlockFrame, { pluginId: plugin.id, blockType: def.id, ...attrs })
        },
      })

      registry.register(def.id, {
        name: def.name ?? def.id,
        description: def.description,
        icon: typeof def.icon === 'string' ? def.icon : undefined,
        component,
        definition: def,
      })
      registry.markDynamic(plugin.id)
    }
  }
})
