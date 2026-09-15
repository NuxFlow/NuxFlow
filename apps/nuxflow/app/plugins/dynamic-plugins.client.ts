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
  let plugins: PublicDynamicPlugin[]
  try {
    const res = await $fetch<{ plugins: PublicDynamicPlugin[] }>('/api/public/dynamic-plugins')
    plugins = res.plugins.filter(p => p.isActive && p.hasClient)
  } catch {
    return
  }

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
