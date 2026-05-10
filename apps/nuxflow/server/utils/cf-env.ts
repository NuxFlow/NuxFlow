import type { H3Event } from 'h3'
import type { KVNamespace, WorkerLoader, WorkerStub, WorkerCode } from '../types/cloudflare-bindings'

interface CfBindings {
  kv: KVNamespace | null
  loader: WorkerLoader | null
}

export function getCfBindings(event: H3Event): CfBindings {
  const env = event.context.cloudflare?.env
  return {
    kv: (env?.PLUGIN_KV as KVNamespace | undefined) ?? null,
    loader: (env?.LOADER as WorkerLoader | undefined) ?? null,
  }
}

export async function getPluginServerCode(event: H3Event, siteId: string, pluginId: string): Promise<string | null> {
  const { kv } = getCfBindings(event)
  if (!kv) return null
  return kv.get(`plugin:${siteId}:${pluginId}:server`)
}

export async function getPluginClientBundle(event: H3Event, siteId: string, pluginId: string): Promise<string | null> {
  const { kv } = getCfBindings(event)
  if (!kv) return null
  return kv.get(`plugin:${siteId}:${pluginId}:client`)
}

export async function putPluginServerCode(event: H3Event, siteId: string, pluginId: string, code: string): Promise<void> {
  const { kv } = getCfBindings(event)
  if (!kv) throw createError({ statusCode: 503, message: 'Dynamic plugins require a Cloudflare KV namespace (PLUGIN_KV). Configure it in wrangler.toml.' })
  await kv.put(`plugin:${siteId}:${pluginId}:server`, code)
}

export async function putPluginClientBundle(event: H3Event, siteId: string, pluginId: string, bundle: string): Promise<void> {
  const { kv } = getCfBindings(event)
  if (!kv) throw createError({ statusCode: 503, message: 'Dynamic plugins require a Cloudflare KV namespace (PLUGIN_KV). Configure it in wrangler.toml.' })
  await kv.put(`plugin:${siteId}:${pluginId}:client`, bundle)
}

export async function deletePluginAssets(event: H3Event, siteId: string, pluginId: string): Promise<void> {
  const { kv } = getCfBindings(event)
  if (!kv) return
  await Promise.all([
    kv.delete(`plugin:${siteId}:${pluginId}:server`),
    kv.delete(`plugin:${siteId}:${pluginId}:client`),
  ])
}

export async function getThemeCSS(event: H3Event, siteId: string, themeId: string): Promise<string | null> {
  const { kv } = getCfBindings(event)
  if (!kv) return null
  return kv.get(`theme:${siteId}:${themeId}:css`)
}

export async function putThemeCSS(event: H3Event, siteId: string, themeId: string, css: string): Promise<void> {
  const { kv } = getCfBindings(event)
  if (!kv) throw createError({ statusCode: 503, message: 'CSS themes require a Cloudflare KV namespace (PLUGIN_KV). Configure it in wrangler.toml.' })
  await kv.put(`theme:${siteId}:${themeId}:css`, css)
}

export async function deleteThemeCSS(event: H3Event, siteId: string, themeId: string): Promise<void> {
  const { kv } = getCfBindings(event)
  if (!kv) return
  await kv.delete(`theme:${siteId}:${themeId}:css`)
}

export function spawnPluginWorker(
  event: H3Event,
  cacheId: string,
  getCode: () => Promise<string>,
): WorkerStub {
  const { loader } = getCfBindings(event)
  if (!loader) throw createError({ statusCode: 503, message: 'Dynamic Workers (LOADER binding) are not available in this environment.' })

  return loader.get(cacheId, async (): Promise<WorkerCode> => {
    const code = await getCode()
    return {
      compatibilityDate: '2026-04-01',
      mainModule: 'index.js',
      modules: { 'index.js': code },
    }
  })
}
