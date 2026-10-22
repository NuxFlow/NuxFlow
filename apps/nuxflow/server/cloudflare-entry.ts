// Worker entry (nuxt.config.ts → nitro.entry). Nitro's own cloudflare-module entry is the
// default export — fetch, scheduled and the rest unchanged — and the named exports add the
// loopback entrypoints dynamic plugins are given. Cloudflare puts every named
// WorkerEntrypoint export into `ctx.exports`, which is how plugin-runtime.ts makes
// per-plugin stubs of them (compatibility date >= 2025-11-17 turns ctx.exports on).
import handler from 'nitropack/presets/cloudflare/runtime/cloudflare-module'

export { NuxflowPluginHost, NuxflowPluginEgress } from './plugin-host/entrypoints'
// A member pool's private admin entrypoint, called by its control plane over a service binding.
export { NuxflowPoolAdmin } from './pool-host/entrypoint'
// The control plane's entrypoint for its pools (sign-in across pools), over each pool's CONTROL_PLANE binding.
export { NuxflowControlPlane } from './pool-host/control-plane-entrypoint'

type EmailHandler = (message: ForwardableEmailMessage, env: unknown, ctx: ExecutionContext) => unknown

/**
 * Nitro's email() hands the `cloudflare:email` hook to ctx.waitUntil() and returns at
 * once, and the runtime then treats the message as dealt with: message.forward() and
 * setReject() called afterwards fail ("RPC stub used after being disposed"), so a mailbox's
 * forwarding copy never went out. This waits for the hook (server/plugins/inbound-email.ts)
 * to finish before returning.
 */
async function email(message: ForwardableEmailMessage, env: unknown, ctx: ExecutionContext): Promise<void> {
  const pending: Promise<unknown>[] = []
  const tracked = new Proxy(ctx, {
    get(target, prop) {
      if (prop === 'waitUntil') {
        return (promise: Promise<unknown>) => {
          pending.push(promise)
          target.waitUntil(promise)
        }
      }
      const value = Reflect.get(target, prop, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  await (handler as unknown as { email: EmailHandler }).email(message, env, tracked)
  await Promise.allSettled(pending)
}

export default { ...handler, email }
