// Worker entry (nuxt.config.ts → nitro.entry). Nitro's own cloudflare-module entry is the
// default export unchanged — fetch, scheduled, email and the rest — and the named exports
// add the loopback entrypoints dynamic plugins are given. Cloudflare puts every named
// WorkerEntrypoint export into `ctx.exports`, which is how plugin-runtime.ts makes
// per-plugin stubs of them (compatibility date >= 2025-11-17 turns ctx.exports on).
import handler from 'nitropack/presets/cloudflare/runtime/cloudflare-module'

export { NuxflowPluginHost, NuxflowPluginEgress } from './plugin-host/entrypoints'
export default handler
