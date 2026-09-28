import { describe, it, expect, afterEach, vi } from 'vitest'
import type { H3Event } from 'h3'
import { normalizeDomain } from '../../server/utils/domain'
import { isSiteStorageKey } from '../../server/utils/media-providers/storage-delete'

describe('normalizeDomain', () => {
  it('stores a domain exactly as the Host header will present it', () => {
    expect(normalizeDomain('example.com')).toBe('example.com')
    expect(normalizeDomain('  Example.COM ')).toBe('example.com')
    expect(normalizeDomain('https://Shop.Example.com/some/path?x=1')).toBe('shop.example.com')
    expect(normalizeDomain('example.com.')).toBe('example.com')
    expect(normalizeDomain('example.com:443')).toBe('example.com')
    expect(normalizeDomain('localhost:8787')).toBe('localhost')
  })

  it('punycodes an internationalized name, as browsers send it', () => {
    expect(normalizeDomain('bücher.example')).toBe('xn--bcher-kva.example')
  })

  it('rejects anything that is not a usable hostname', () => {
    for (const bad of ['', '   ', 'not a domain', 'example', '-bad.example.com', 'exa_mple.com', 'http://']) {
      expect(normalizeDomain(bad)).toBeNull()
    }
  })
})

describe('isSiteStorageKey', () => {
  it('accepts only keys under the site\'s own prefix', () => {
    expect(isSiteStorageKey('site-a', 'site-a/01J.jpg')).toBe(true)
    expect(isSiteStorageKey('site-a', 'site-a/themes/01J/hero.png')).toBe(true)
    expect(isSiteStorageKey('site-a', 'site-b/01J.jpg')).toBe(false)
    expect(isSiteStorageKey('site-a', 'site-ab/01J.jpg')).toBe(false)
    expect(isSiteStorageKey('site-a', '_private/site-a/email/x')).toBe(false)
    expect(isSiteStorageKey('site-a', 'photo.jpg')).toBe(false)
  })

  it('rejects dot segments that could walk out of the prefix on a path-based provider', () => {
    expect(isSiteStorageKey('site-a', 'site-a/../site-b/01J.jpg')).toBe(false)
    expect(isSiteStorageKey('site-a', 'site-a/./01J.jpg')).toBe(false)
    expect(isSiteStorageKey('site-a', 'site-a//01J.jpg')).toBe(false)
  })
})

describe('accounts origin (central sign-in)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  async function load(accountsUrl: string) {
    vi.stubGlobal('useRuntimeConfig', () => ({ public: { accountsUrl } }))
    vi.stubGlobal('getHeader', (event: { headers: Record<string, string> }, name: string) => event.headers[name.toLowerCase()])
    return import('../../server/utils/accounts-origin')
  }
  const req = (host: string) => ({ headers: { host } }) as unknown as H3Event

  it('is same-origin mode when NUXT_PUBLIC_ACCOUNTS_URL is unset or invalid', async () => {
    const mod = await load('')
    expect(mod.isCentralAuth()).toBe(false)
    expect(mod.isAccountsHost(req('example.com'))).toBe(false)
    expect(mod.isTenantHostInCentralMode(req('example.com'))).toBe(false)
    expect(mod.accountsUrl('/account')).toBe('/account')

    vi.resetModules()
    const bad = await load('not a url')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(bad.isCentralAuth()).toBe(false)
  })

  it('tells the accounts origin apart from every site domain', async () => {
    const mod = await load('https://accounts.example.com/')
    expect(mod.getAccountsOrigin()).toBe('https://accounts.example.com')
    expect(mod.isAccountsHost(req('accounts.example.com'))).toBe(true)
    expect(mod.isAccountsHost(req('ACCOUNTS.example.com'))).toBe(true)
    expect(mod.isAccountsHost(req('tenant.com'))).toBe(false)
    expect(mod.isAccountsHost(req('accounts.example.com.evil.com'))).toBe(false)
    expect(mod.isTenantHostInCentralMode(req('tenant.com'))).toBe(true)
    expect(mod.isTenantHostInCentralMode(req('accounts.example.com'))).toBe(false)
    expect(mod.accountsUrl('/account')).toBe('https://accounts.example.com/account')
  })

  it('matches the local dev port, and tolerates a port-less Host there', async () => {
    const mod = await load('http://accounts.localhost:8787')
    expect(mod.isAccountsHost(req('accounts.localhost:8787'))).toBe(true)
    expect(mod.isAccountsHost(req('accounts.localhost'))).toBe(true)
    expect(mod.isAccountsHost(req('localhost:8787'))).toBe(false)
  })
})
