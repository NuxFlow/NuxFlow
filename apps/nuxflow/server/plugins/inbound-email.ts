import { handleInboundEmail } from '../utils/inbound-email'

/**
 * Receives mail from Cloudflare Email Routing. Nitro's cloudflare-module preset already
 * exports an `email()` handler on the Worker and re-emits it as this hook (inside
 * `ctx.waitUntil`), so no custom Worker entry is needed — each receiving domain just needs
 * a catch-all routing rule whose action is "Send to Worker" → this Worker. See
 * server/utils/inbound-email.ts and docs/email.md.
 */
export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('cloudflare:email', async ({ message, env, context }) => {
    try {
      await handleInboundEmail(message, env, context)
    }
    catch (err) {
      // Nothing upstream catches this — an uncaught rejection inside waitUntil only
      // surfaces as a generic runtime error, so log it with enough to find the message.
      console.error(JSON.stringify({
        level: 'error',
        source: 'nuxflow:inbound-email',
        from: message.from,
        to: message.to,
        size: message.rawSize,
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      }))
    }
  })
})
