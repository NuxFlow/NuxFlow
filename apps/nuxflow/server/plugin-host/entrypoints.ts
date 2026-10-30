// The two loopback entrypoints dynamic plugins are handed (see server/utils/plugin-runtime.ts),
// exported from the Worker by server/cloudflare-entry.ts so they appear in `ctx.exports`.
//
// They run in *this* Worker, with this Worker's own bindings (D1, KV, AI), and are reached
// from plugin code only through RPC stubs whose `ctx.props` this Worker set when spawning
// the plugin. Plugin code can call the methods below and nothing else; the props it can't
// see or change decide which site, which plugin and which permissions every call acts on.
import { WorkerEntrypoint } from 'cloudflare:workers'
import { httpErrorStatus, isH3Error } from '../utils/errors'
import { createSystemEvent } from '../utils/system-event'
import { PLUGIN_API_METHODS, PluginApiError, type PluginCallContext } from '../utils/plugin-api'
import { egressFetch, type PluginEgressProps } from '../utils/plugin-egress'
import type { PluginHostProps } from '../utils/plugin-runtime'

type Method = keyof typeof PLUGIN_API_METHODS

export class NuxflowPluginHost extends WorkerEntrypoint<Record<string, unknown>, PluginHostProps> {
  private async call(method: Method, args: unknown[]): Promise<unknown> {
    // Same as Nitro's own handlers: utilities that read the env without an event (e.g.
    // useRuntimeConfig's env overrides) find it here even in an isolate that hasn't served
    // a request yet.
    globalThis.__env__ = this.env as NuxFlowCloudflareEnv
    const props = this.ctx.props
    const ctx: PluginCallContext = {
      event: createSystemEvent({ env: this.env, ctx: this.ctx, siteId: props.siteId, host: props.host }),
      siteId: props.siteId,
      pluginId: props.pluginId,
      permissions: props.permissions,
    }
    try {
      return await (PLUGIN_API_METHODS[method] as (c: PluginCallContext, ...a: unknown[]) => Promise<unknown>)(ctx, ...args)
    } catch (err) {
      // Messages written for the plugin (and the platform's own 4xx, e.g. a plan limit or
      // a rate limit) go back as-is; anything else is logged here and returned generically,
      // so internal details never cross into plugin code. These errors are serialised back
      // over RPC, so they deliberately carry no `cause` — that would hand the original
      // error (SQL, stack, internal data) to the plugin.
      /* eslint-disable preserve-caught-error */
      if (err instanceof PluginApiError) throw new Error(err.message)
      if (isH3Error(err) && (httpErrorStatus(err) ?? 500) < 500) throw new Error(err.message)
      console.error(`[plugin-host] ${props.pluginId}.${method} failed on site ${props.siteId}:`, err)
      throw new Error(`NuxFlow could not complete ${method} — try again later.`)
      /* eslint-enable preserve-caught-error */
    }
  }

  getSettings() { return this.call('getSettings', []) }
  storageGet(key: unknown) { return this.call('storageGet', [key]) }
  storagePut(key: unknown, value: unknown, options?: unknown) { return this.call('storagePut', [key, value, options]) }
  storageDelete(key: unknown) { return this.call('storageDelete', [key]) }
  storageList(options?: unknown) { return this.call('storageList', [options]) }
  listContent(options?: unknown) { return this.call('listContent', [options]) }
  getContent(options?: unknown) { return this.call('getContent', [options]) }
  createDraft(input: unknown) { return this.call('createDraft', [input]) }
  generateText(input: unknown) { return this.call('generateText', [input]) }
  notifyAdmins(input: unknown) { return this.call('notifyAdmins', [input]) }
}

export class NuxflowPluginEgress extends WorkerEntrypoint<Record<string, unknown>, PluginEgressProps> {
  override fetch(request: Request): Promise<Response> {
    return egressFetch(request, this.ctx.props)
  }
}
