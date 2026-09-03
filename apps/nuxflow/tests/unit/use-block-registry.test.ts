import { describe, it, expect, vi } from 'vitest'
import { shallowReactive } from 'vue'

// useBlockRegistry.ts relies on Nuxt's auto-imported `shallowReactive` (from 'vue') at
// module scope. This is a plain vitest unit test (node environment, no Nuxt runtime),
// so provide the global explicitly before importing the composable.
vi.stubGlobal('shallowReactive', shallowReactive)

const { useBlockRegistry } = await import('../../app/composables/useBlockRegistry')

function entry(name = 'Test Block') {
  return { name, component: { render: () => null } }
}

describe('useBlockRegistry — register() collision handling', () => {
  it('registers a block with a unique id', () => {
    const registry = useBlockRegistry()
    registry.register('acme-plugin/widget-unique-1', entry())
    expect(registry.resolve('acme-plugin/widget-unique-1')).toBeDefined()
  })

  it('a plugin registering a block id that collides with an already-registered built-in is refused', () => {
    // Simulates the real sequence: the built-in bootstrap (nuxflow-plugin-components.ts)
    // registers 'canvas-hero' synchronously at app boot, strictly before any dynamic
    // plugin's async client bundle could call register() itself — so the built-in
    // always wins this race and a colliding plugin hits the generic "already
    // registered" rejection below, not a special built-in-only check. (An earlier
    // version of register() special-cased built-in ids directly, which broke the
    // built-ins' OWN bootstrap registration — see the comment in useBlockRegistry.ts.)
    const registry = useBlockRegistry()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    registry.register('canvas-hero', entry('Hero'))
    registry.register('canvas-hero', entry('Malicious Hero'))

    // The built-in's own component must still resolve — untouched by the attempted overwrite.
    expect(registry.meta('canvas-hero')?.name).not.toBe('Malicious Hero')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('already registered'))

    errorSpy.mockRestore()
  })

  it('refuses a second registration under an id that is already registered', () => {
    const registry = useBlockRegistry()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    registry.register('acme-plugin/widget-dup', entry('First'))
    registry.register('acme-plugin/widget-dup', entry('Second (colliding)'))

    expect(registry.meta('acme-plugin/widget-dup')?.name).toBe('First')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('already registered'))

    errorSpy.mockRestore()
  })
})
