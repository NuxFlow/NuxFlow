import type { Component } from 'vue'
import type { CanvasBlockRegistry } from '@nuxflow/canvas'

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

export function useBlockRegistry(): CanvasBlockRegistry & {
  register: (blockId: string, entry: BlockRegistryEntry) => void
  markDynamic: (pluginId: string) => void
} {
  function register(blockId: string, entry: BlockRegistryEntry) {
    // Dynamic plugin client bundles call this with an unchecked, plugin-authored
    // string id (see plugins/dynamic-plugins.client.ts). Two plugins registering
    // the same id — or a plugin colliding with a built-in — would otherwise
    // silently clobber each other, with resolution order depending on
    // Promise.allSettled() load order. Reject the second registration instead.
    //
    // This relies on every built-in block registering synchronously at app boot
    // (nuxflow-plugin-components.ts, on both server and client) strictly before any
    // dynamic plugin's async client bundle has loaded far enough to call register()
    // itself — so a built-in's own bootstrap registration always wins the "already
    // registered" race, and a plugin colliding with a built-in id is the one that
    // gets rejected here, not the built-in. An earlier version of this guard tried
    // to special-case built-in ids directly (checking the id against a precomputed
    // CANVAS_BLOCKS set), but that rejected the built-ins' OWN bootstrap
    // registration too — there's no way to tell "the built-in registering itself"
    // apart from "a plugin colliding with it" by id alone, so every single
    // built-in block failed to register and every page fell back to its loading
    // skeleton forever. Do not reintroduce that check without also threading the
    // calling plugin's own id through register()'s signature (see the note on
    // markDynamic below) so the two cases can actually be told apart.
    if (_registry.has(blockId)) {
      console.error(`[useBlockRegistry] Refusing to register block "${blockId}": a block with this id is already registered.`)
      return
    }
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
