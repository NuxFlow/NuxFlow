import { describe, it, expect } from 'vitest'
import { PLUGIN_REGISTRY, getRegisteredPlugin, getRegisteredPluginByEntrypoint } from '../../server/utils/plugin-registry'

describe('PLUGIN_REGISTRY', () => {
  it('contains at least one plugin', () => {
    expect(PLUGIN_REGISTRY.length).toBeGreaterThan(0)
  })

  it('every plugin has a unique id', () => {
    const ids = PLUGIN_REGISTRY.map(p => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every plugin has a unique entrypoint', () => {
    const eps = PLUGIN_REGISTRY.map(p => p.entrypoint)
    expect(new Set(eps).size).toBe(eps.length)
  })

  it('every plugin has required fields', () => {
    for (const plugin of PLUGIN_REGISTRY) {
      expect(plugin.id, `${plugin.id}: id`).toBeTruthy()
      expect(plugin.name, `${plugin.id}: name`).toBeTruthy()
      expect(plugin.version, `${plugin.id}: version`).toBeTruthy()
      expect(plugin.entrypoint, `${plugin.id}: entrypoint`).toBeTruthy()
      expect(Array.isArray(plugin.permissions), `${plugin.id}: permissions`).toBe(true)
      expect(Array.isArray(plugin.adminPages), `${plugin.id}: adminPages`).toBe(true)
      expect(Array.isArray(plugin.blocks), `${plugin.id}: blocks`).toBe(true)
    }
  })

  it('every block entry has id, name, and component', () => {
    for (const plugin of PLUGIN_REGISTRY) {
      for (const block of plugin.blocks) {
        expect(block.id, `${plugin.id}/${block.id}: id`).toBeTruthy()
        expect(block.name, `${plugin.id}/${block.id}: name`).toBeTruthy()
        expect(block.component, `${plugin.id}/${block.id}: component`).toBeTruthy()
      }
    }
  })

  it('every admin page has path, component, label, and icon', () => {
    for (const plugin of PLUGIN_REGISTRY) {
      for (const page of plugin.adminPages) {
        expect(page.path, `${plugin.id}: adminPage.path`).toBeTruthy()
        expect(page.component, `${plugin.id}: adminPage.component`).toBeTruthy()
        expect(page.label, `${plugin.id}: adminPage.label`).toBeTruthy()
        expect(page.icon, `${plugin.id}: adminPage.icon`).toBeTruthy()
      }
    }
  })

  it('canvas plugin is registered with 9 blocks and a contentEditor', () => {
    const canvas = PLUGIN_REGISTRY.find(p => p.id === 'canvas')
    expect(canvas).toBeDefined()
    expect(canvas!.blocks).toHaveLength(9)
    expect(canvas!.contentEditor).toBeDefined()
    expect(canvas!.contentEditor?.contentType).toBe('canvas')
  })
})

describe('getRegisteredPlugin', () => {
  it('returns the plugin for a known id', () => {
    const first = PLUGIN_REGISTRY[0]!
    const result = getRegisteredPlugin(first.id)
    expect(result?.id).toBe(first.id)
  })

  it('returns undefined for an unknown id', () => {
    expect(getRegisteredPlugin('does-not-exist')).toBeUndefined()
  })
})

describe('getRegisteredPluginByEntrypoint', () => {
  it('returns the plugin for a known entrypoint', () => {
    const first = PLUGIN_REGISTRY[0]!
    const result = getRegisteredPluginByEntrypoint(first.entrypoint)
    expect(result?.entrypoint).toBe(first.entrypoint)
  })

  it('returns undefined for an unknown entrypoint', () => {
    expect(getRegisteredPluginByEntrypoint('@nuxflow/plugin-nonexistent')).toBeUndefined()
  })
})
