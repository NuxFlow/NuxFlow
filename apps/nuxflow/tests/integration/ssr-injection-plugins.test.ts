/**
 * Integration tests for the two Nitro render:html plugins that write into every SSR
 * page, plus the theme CSS KV layer they read from:
 *   server/plugins/site-settings-resolver.ts  — dark mode, primary colour, font, and
 *                                               consent-gated custom head/body HTML
 *   server/plugins/theme-resolver.ts          — active/preview/customizer theme CSS
 *   server/utils/cf-theme-kv.ts               — versioned keys, legacy fallback, sanitize
 *
 * Both plugins inject raw strings into the document, so the focus is on what can and
 * cannot reach the page: colour/font allowlists, CSS sanitization, admin exclusion,
 * cross-site preview isolation, and GDPR consent gating.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedSetting } from '../helpers/seed'
import { themes, siteSettings } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

type RenderHook = (html: RenderHtml, ctx: { event: H3Event }) => Promise<void>
interface RenderHtml { head: string[]; bodyAppend: string[] }

globalThis.defineNitroPlugin = ((fn: unknown) => fn) as never

function captureRenderHook(plugin: (nitro: unknown) => void): RenderHook {
  let hook: RenderHook | undefined
  plugin({ hooks: { hook: (name: string, fn: RenderHook) => { if (name === 'render:html') hook = fn } } })
  return hook!
}

const { default: settingsPlugin } = await import('../../server/plugins/site-settings-resolver')
const { default: themePlugin } = await import('../../server/plugins/theme-resolver')
const { clearAppearanceCache } = await import('../../server/utils/appearance-cache')
const { clearCachedThemeCss } = await import('../../server/utils/theme-cache')
const themeKv = await import('../../server/utils/cf-theme-kv')
const themeCache = await import('../../server/utils/theme-cache')

const renderSettings = captureRenderHook(settingsPlugin as never)
const renderTheme = captureRenderHook(themePlugin as never)

const SITE = 'site-ssr-inject-01'
const OTHER = 'site-ssr-inject-02'

const kvStore = new Map<string, string>()
const kv = {
  get: vi.fn(async (k: string) => kvStore.get(k) ?? null),
  put: vi.fn(async (k: string, v: string) => { kvStore.set(k, v) }),
  delete: vi.fn(async (k: string) => { kvStore.delete(k) }),
}

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: 'ssr.localhost' })
  await seedSite(db, { id: OTHER, domain: 'ssr2.localhost' })
})
afterAll(teardownTestDb)

function ev(opts: { siteId?: string | null; path?: string; headers?: Record<string, string>; previewId?: string } = {}) {
  const e = createMockEvent({ siteId: opts.siteId ?? SITE, path: opts.path ?? '/', headers: { host: 'ssr.localhost', ...opts.headers } }) as unknown as H3Event & { context: Record<string, unknown> }
  if (opts.siteId === null) e.context.siteId = null
  e.context.cloudflare = { env: { PLUGIN_KV: kv } }
  if (opts.previewId) e.context.themePreviewId = opts.previewId
  return e as unknown as H3Event
}

const blank = (): RenderHtml => ({ head: [], bodyAppend: [] })

async function setSetting(key: string, value: string) {
  const db = getCurrentTestDb()
  await db.delete(siteSettings).where(and(eq(siteSettings.siteId, SITE), eq(siteSettings.key, key)))
  await seedSetting(db, SITE, key, value)
  clearAppearanceCache(SITE)
}

// ── site-settings-resolver ─────────────────────────────────────────────────────

describe('site-settings-resolver', () => {
  beforeEach(async () => {
    const db = getCurrentTestDb()
    await db.delete(siteSettings).where(eq(siteSettings.siteId, SITE))
    clearAppearanceCache(SITE)
  })

  it('does nothing without a resolved site', async () => {
    const html = blank()
    await renderSettings(html, { event: ev({ siteId: null }) })
    expect(html).toEqual(blank())
  })

  it('injects the dark-mode class script before paint, only on public pages', async () => {
    await setSetting('theme.dark_mode', 'dark')
    const pub = blank()
    await renderSettings(pub, { event: ev() })
    expect(pub.head[0]).toBe(`<script>document.documentElement.classList.add('dark')</script>`)

    const admin = blank()
    await renderSettings(admin, { event: ev({ path: '/admin/settings' }) })
    expect(admin.head.join('')).not.toContain('classList')
  })

  it('injects a valid primary colour everywhere, including admin', async () => {
    await setSetting('theme.primary_color', '#ff0066')
    const admin = blank()
    await renderSettings(admin, { event: ev({ path: '/admin' }) })
    expect(admin.head.join('')).toContain('--nuxflow-primary:#ff0066')
  })

  it.each([
    'red;}</style><script>alert(1)</script>',
    'url(https://evil.test/x)',
    'expression(alert(1))',
    '#fff;background:url(x)',
  ])('drops an unsafe primary colour value: %s', async (value) => {
    await setSetting('theme.primary_color', value)
    const html = blank()
    await renderSettings(html, { event: ev() })
    expect(html.head.join('')).not.toContain('--nuxflow-primary')
    expect(html.head.join('')).not.toContain('<script>alert')
  })

  it('only loads fonts from the allowlist', async () => {
    await setSetting('theme.font_sans', 'Inter')
    const ok = blank()
    await renderSettings(ok, { event: ev() })
    const head = ok.head.join('\n')
    expect(head).toContain('https://fonts.googleapis.com/css2?family=Inter')
    expect(head).toContain(`--nuxflow-font:'Inter'`)

    await setSetting('theme.font_sans', `Evil'</style><script>x</script>`)
    const bad = blank()
    await renderSettings(bad, { event: ev() })
    expect(bad.head.join('')).not.toContain('fonts.googleapis.com')
    expect(bad.head.join('')).not.toContain('<script>x')
  })

  describe('custom head/body HTML consent gating', () => {
    const TAG = '<script src="https://analytics.test/t.js"></script>'
    beforeEach(async () => {
      await setSetting('appearance.custom_head_html', TAG)
      await setSetting('appearance.custom_body_html', '<noscript>pixel</noscript>')
    })

    it('injects directly for a visitor outside the GDPR zone', async () => {
      const html = blank()
      await renderSettings(html, { event: ev({ headers: { 'cf-ipcountry': 'US' } }) })
      expect(html.head).toContain(TAG)
      expect(html.bodyAppend).toContain('<noscript>pixel</noscript>')
    })

    it('wraps the code inert (with an activation script) for a GDPR visitor without consent', async () => {
      const html = blank()
      await renderSettings(html, { event: ev({ headers: { 'cf-ipcountry': 'DE' } }) })
      expect(html.head).not.toContain(TAG)
      expect(html.head).toContain(`<template data-nuxflow-consent-html="head">${TAG}</template>`)
      expect(html.bodyAppend.join('')).toContain('nuxflow:consent-updated')
    })

    it('injects directly for a GDPR visitor who granted analytics consent', async () => {
      const cookie = `nuxflow_consent=${encodeURIComponent(JSON.stringify({ necessary: true, analytics: true, marketing: false }))}`
      const html = blank()
      await renderSettings(html, { event: ev({ headers: { 'cf-ipcountry': 'FR', cookie } }) })
      expect(html.head).toContain(TAG)
    })

    it('never injects custom code into the admin', async () => {
      const html = blank()
      await renderSettings(html, { event: ev({ path: '/admin', headers: { 'cf-ipcountry': 'US' } }) })
      expect(html.head.join('')).not.toContain('analytics.test')
      expect(html.bodyAppend).toEqual([])
    })
  })
})

// ── cf-theme-kv ────────────────────────────────────────────────────────────────

describe('cf-theme-kv', () => {
  it('putThemeCSS sanitizes, bumps cssVersion, and writes a new versioned key each publish', async () => {
    const db = getCurrentTestDb()
    await db.insert(themes).values({ id: 'th-put', siteId: SITE, packageName: 'x', name: 'X', version: '1', hasCss: true })

    await themeKv.putThemeCSS(ev(), SITE, 'th-put', 'body{color:red}</style><script>alert(1)</script>')
    await themeKv.putThemeCSS(ev(), SITE, 'th-put', 'body{color:blue}')

    const row = await db.query.themes.findFirst({ where: eq(themes.id, 'th-put') })
    expect(row?.cssVersion).toBe(2)
    expect(kvStore.get(`theme:${SITE}:th-put:css:v1`)).not.toContain('</style')
    expect(kvStore.get(`theme:${SITE}:th-put:css:v2`)).toBe('body{color:blue}')

    clearCachedThemeCss(SITE, 'th-put')
    expect(await themeKv.getThemeCSS(ev(), SITE, 'th-put')).toBe('body{color:blue}')
  })

  it('falls back to the pre-versioning key for v0 themes, copies it forward, and sanitizes on read', async () => {
    const db = getCurrentTestDb()
    await db.insert(themes).values({ id: 'th-legacy', siteId: SITE, packageName: 'x', name: 'L', version: '1', hasCss: true })
    kvStore.set(`theme:${SITE}:th-legacy:css`, 'a{background:url(https://evil.test/?x)}')

    const css = await themeKv.getThemeCSS(ev(), SITE, 'th-legacy')
    expect(css).not.toContain('evil.test')
    expect(kvStore.get(`theme:${SITE}:th-legacy:css:v0`)).toBe('a{background:url(https://evil.test/?x)}')
  })

  it('503s on publish without a KV binding', async () => {
    vi.resetModules()
    const fresh = await import('../../server/utils/cf-theme-kv')
    const noKv = createMockEvent({ siteId: SITE }) as unknown as H3Event
    await expect(fresh.putThemeCSS(noKv, SITE, 'th-put', 'a{}')).rejects.toMatchObject({ statusCode: 503 })
  })

  it('deletes the current version\'s CSS and the demo payload', async () => {
    await themeKv.putThemeDemo(ev(), SITE, 'th-put', '{"demo":1}')
    expect(await themeKv.getThemeDemo(ev(), SITE, 'th-put')).toBe('{"demo":1}')
    await themeKv.deleteThemeDemo(ev(), SITE, 'th-put')
    await themeKv.deleteThemeCSS(ev(), SITE, 'th-put')
    expect(await themeKv.getThemeDemo(ev(), SITE, 'th-put')).toBeNull()
    expect(kvStore.has(`theme:${SITE}:th-put:css:v2`)).toBe(false)
  })
})

// ── theme-resolver ─────────────────────────────────────────────────────────────

describe('theme-resolver', () => {
  beforeAll(async () => {
    const db = getCurrentTestDb()
    await db.update(themes).set({ isActive: false }).where(eq(themes.siteId, SITE))
    await db.insert(themes).values([
      { id: 'th-active', siteId: SITE, packageName: 'pkg-active', name: 'Active', version: '1', hasCss: true, isActive: true },
      { id: 'th-preview', siteId: SITE, packageName: 'pkg-preview', name: 'Preview', version: '1', hasCss: true },
      { id: 'th-foreign', siteId: OTHER, packageName: 'pkg-foreign', name: 'Foreign', version: '1', hasCss: true },
    ])
    kvStore.set(`theme:${SITE}:th-active:css:v0`, ':root{--a:1}')
    kvStore.set(`theme:${SITE}:th-preview:css:v0`, ':root{--p:1}')
    kvStore.set(`theme:${OTHER}:th-foreign:css:v0`, ':root{--foreign:1}')
  })

  beforeEach(async () => {
    await themeCache.clearActiveThemeCache(ev(), SITE)
    for (const id of ['th-active', 'th-preview', 'th-foreign', 'th-base', 'th-cust']) clearCachedThemeCss(SITE, id)
  })

  it('injects the active theme\'s CSS on public pages but never in the admin', async () => {
    const pub = blank()
    await renderTheme(pub, { event: ev() })
    expect(pub.head).toEqual(['<style data-nuxflow-theme>:root{--a:1}</style>'])

    const admin = blank()
    await renderTheme(admin, { event: ev({ path: '/admin/themes' }) })
    expect(admin.head).toEqual([])
  })

  it('serves a preview theme instead of the active one when the preview middleware set one', async () => {
    const html = blank()
    await renderTheme(html, { event: ev({ previewId: 'th-preview' }) })
    expect(html.head).toEqual(['<style data-nuxflow-theme="preview">:root{--p:1}</style>'])
  })

  it('ignores a preview id belonging to another site and falls back to the active theme', async () => {
    const html = blank()
    await renderTheme(html, { event: ev({ previewId: 'th-foreign' }) })
    expect(html.head.join('')).not.toContain('--foreign')
    expect(html.head).toEqual(['<style data-nuxflow-theme>:root{--a:1}</style>'])
  })

  it('injects a customizer theme after its base theme so the customizer wins the cascade', async () => {
    const db = getCurrentTestDb()
    await db.update(themes).set({ isActive: false }).where(eq(themes.id, 'th-active'))
    await db.insert(themes).values([
      { id: 'th-base', siteId: SITE, packageName: 'pkg-base', name: 'Base', version: '1', hasCss: true },
      { id: 'th-cust', siteId: SITE, packageName: '@customizer/site', name: 'Custom', version: '1', hasCss: true, isActive: true },
    ])
    kvStore.set(`theme:${SITE}:th-base:css:v0`, ':root{--x:base}')
    kvStore.set(`theme:${SITE}:th-cust:css:v0`, ':root{--x:custom}')
    await seedSetting(db, SITE, 'theme.base_theme_id', 'th-base')

    const html = blank()
    await renderTheme(html, { event: ev() })
    expect(html.head).toEqual([
      '<style data-nuxflow-theme="base">:root{--x:base}</style>',
      '<style data-nuxflow-theme>:root{--x:custom}</style>',
    ])
  })

  it('swallows lookup failures instead of breaking the page render', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    kv.get.mockRejectedValueOnce(new Error('KV down'))
    const html = blank()
    await expect(renderTheme(html, { event: ev() })).resolves.toBeUndefined()
    spy.mockRestore()
  })
})
