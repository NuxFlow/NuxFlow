import { describe, expect, it, vi } from 'vitest'
import { pickTarget, DIRECTORY_CACHE_TTL_SECONDS, type RouterEnv } from '../../../../packages/router/src/route'
import { directoryKey, normalizeHostname } from '../../shared/lib/pool-id'

function fetcher(name: string) {
  return { fetch: vi.fn(async () => new Response(name)) }
}

function env(directory: Record<string, string>, extra: Record<string, unknown> = {}) {
  const get = vi.fn(async (key: string) => directory[key] ?? null)
  return {
    get,
    env: { DIRECTORY: { get }, CONTROL_PLANE: fetcher('control'), POOL_CLIENTX: fetcher('clientx'), ...extra } as RouterEnv,
  }
}

const req = (url: string) => new Request(url)

describe('front-door router', () => {
  it('sends an address in the directory to its pool', async () => {
    const { env: e } = env({ [directoryKey('client.example')]: 'clientx' })
    const { poolId, target } = await pickTarget(req('https://client.example/about'), e)
    expect(poolId).toBe('clientx')
    expect(target).toBe(e.POOL_CLIENTX)
  })

  it('sends every other address to the control plane', async () => {
    const { env: e } = env({})
    const { poolId, target } = await pickTarget(req('https://shop.example/'), e)
    expect(poolId).toBeNull()
    expect(target).toBe(e.CONTROL_PLANE)
  })

  it('looks the address up the way sites store it, with a short edge cache', async () => {
    const { env: e, get } = env({ [directoryKey('client.example')]: 'clientx' })
    expect((await pickTarget(req('https://CLIENT.Example./'), e)).poolId).toBe('clientx')
    expect(get).toHaveBeenCalledWith('pool-route:client.example', { cacheTtl: DIRECTORY_CACHE_TTL_SECONDS })
  })

  it('falls back to the control plane when the pool has no binding here', async () => {
    const { env: e } = env({ [directoryKey('new.example')]: 'brand-new' })
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await pickTarget(req('https://new.example/'), e)).target).toBe(e.CONTROL_PLANE)
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('no POOL_BRAND_NEW binding'))
    errors.mockRestore()
  })

  it('falls back to the control plane when the directory can\'t be read', async () => {
    const e = { DIRECTORY: { get: async () => { throw new Error('KV down') } }, CONTROL_PLANE: fetcher('control') } as RouterEnv
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await pickTarget(req('https://client.example/'), e)).target).toBe(e.CONTROL_PLANE)
    errors.mockRestore()
  })

  it('normalizes host names like the directory does', () => {
    expect(normalizeHostname(' Shop.Example.COM.:443 ')).toBe('shop.example.com')
    expect(directoryKey('WWW.Example.com')).toBe('pool-route:www.example.com')
  })
})
