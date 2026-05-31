// Dynamically loads client bundles for active dynamic plugins at runtime.
// This plugin is client-only — dynamic plugin components are not SSR'd.
// Each plugin's client bundle must export:
//   register(app: App, registry: BlockRegistry, vue: typeof import('vue')): void
//
// Vue is passed as the third argument so plugin bundles don't need to import
// it as a bare specifier (which would fail without an import map).

import * as vue from 'vue'

export default defineNuxtPlugin(async (nuxtApp) => {
  let plugins: Array<{ id: string; hasClient: boolean }>
  try {
    const res = await $fetch<{ plugins: Array<{ id: string; hasClient: boolean; isActive: boolean }> }>('/api/v1/dynamic-plugins')
    plugins = res.plugins.filter(p => p.isActive && p.hasClient)
  } catch {
    return
  }

  if (plugins.length === 0) return

  const registry = useBlockRegistry()

  const results = await Promise.allSettled(
    plugins.map(async (plugin) => {
      const module = await import(/* @vite-ignore */ `/_nuxflow/plugin-bundle/${plugin.id}`) as {
        register?: (
          app: typeof nuxtApp.vueApp,
          registry: ReturnType<typeof useBlockRegistry>,
          vueLib: typeof vue,
        ) => void
      }
      if (typeof module.register === 'function') {
        module.register(nuxtApp.vueApp, registry, vue)
        // Mark the plugin ID so dynamicBlocks() in the registry can identify
        // which blocks came from dynamic plugins vs bundled plugins.
        registry.markDynamic(plugin.id)
      }
      return plugin.id
    }),
  )

  if (import.meta.dev) {
    results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .forEach((r, i) => console.error(`[dynamic-plugins] Failed to load plugin "${plugins[i]?.id}":`, r.reason))
  }
})
