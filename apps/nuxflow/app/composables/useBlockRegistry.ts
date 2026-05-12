import type { Component } from 'vue'

interface BlockRegistryEntry {
  name: string
  description?: string
  icon?: string
  component: Component
  // Full CanvasBlockDefinition for the settings panel field editor.
  // Typed as unknown to avoid coupling this composable to @nuxflow/plugin-canvas.
  // useCanvas.ts casts it to CanvasBlockDefinition after retrieval.
  definition?: unknown
}

// Module-level singletons — safe to initialise before Nuxt context exists.
// Block components can't be JSON-serialised so useState would break SSR
// hydration; plain reactive collections are correct here.
const _registry = shallowReactive(new Map<string, BlockRegistryEntry>())
// Plugin IDs (e.g. 'hello-banner') registered by active dynamic plugins.
const _dynamicPluginIds = shallowReactive(new Set<string>())

export function useBlockRegistry() {
  function register(blockId: string, entry: BlockRegistryEntry) {
    _registry.set(blockId, entry)
  }

  // Called by dynamic-plugins.client.ts after a plugin's client bundle loads.
  // Marks all blocks whose ID is prefixed '{pluginId}/' as dynamic so the
  // Canvas block picker can show them in the Plugins section.
  function markDynamic(pluginId: string) {
    _dynamicPluginIds.add(pluginId)
  }

  // Returns only blocks that belong to an active dynamic plugin.
  function dynamicBlocks(): Array<{ id: string } & Omit<BlockRegistryEntry, 'component' | 'definition'>> {
    const out: Array<{ id: string } & Omit<BlockRegistryEntry, 'component' | 'definition'>> = []
    for (const [id, entry] of _registry.entries()) {
      const isDynamic = [..._dynamicPluginIds].some(pid => id === pid || id.startsWith(pid + '/'))
      if (isDynamic) {
        const { component: _c, definition: _d, ...rest } = entry
        out.push({ id, ...rest })
      }
    }
    return out
  }

  function resolve(blockId: string): Component | undefined {
    return _registry.get(blockId)?.component
  }

  function meta(blockId: string): Omit<BlockRegistryEntry, 'component' | 'definition'> | undefined {
    const entry = _registry.get(blockId)
    if (!entry) return undefined
    const { component: _c, definition: _d, ...rest } = entry
    return rest
  }

  // Returns the full block definition registered by the plugin (if any).
  // The canvas editor uses this to render the settings panel for dynamic plugin blocks.
  function getDefinition(blockId: string): unknown {
    return _registry.get(blockId)?.definition
  }

  function all(): Array<{ id: string } & BlockRegistryEntry> {
    return Array.from(_registry.entries()).map(([id, entry]) => ({ id, ...entry }))
  }

  return { register, markDynamic, dynamicBlocks, resolve, meta, getDefinition, all }
}
