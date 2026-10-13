import { describe, it, expect } from 'vitest'

;(globalThis as Record<string, unknown>).defineNuxtPlugin = (plugin: unknown) => plugin
const { default: plugin } = await import('../../app/plugins/payload-path.server')

function run(path: string | undefined): string | undefined {
  const nuxtApp = { payload: { path } }
  ;(plugin as unknown as { setup: (app: typeof nuxtApp) => void }).setup(nuxtApp)
  return nuxtApp.payload.path
}

// The rendered page is cached for every visitor of the clean URL, so the payload must not
// record the first visitor's click id.
describe('payload-path plugin', () => {
  it('leaves a path without tracking parameters alone', () => {
    expect(run('/about')).toBe('/about')
    expect(run('/blog?page=2')).toBe('/blog?page=2')
    expect(run(undefined)).toBeUndefined()
  })

  it('records only the pathname when tracking parameters were present', () => {
    expect(run('/about?fbclid=abc')).toBe('/about')
    // Not '/blog?page=2': a recorded query no longer matches the address bar, and Nuxt would
    // then navigate to it, dropping the visitor's own parameters.
    expect(run('/blog?page=2&utm_source=x')).toBe('/blog')
  })
})
