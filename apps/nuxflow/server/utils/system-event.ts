import type { IncomingMessage, ServerResponse } from 'node:http'
import { createEvent, type H3Event } from 'h3'
import type { NuxFlowCloudflareEnv } from '../types/cloudflare-bindings'

interface SystemEventOptions {
  env: unknown
  ctx?: { waitUntil(promise: Promise<unknown>): void }
  siteId?: string
  /** Becomes the `host` header — email.ts derives the default `noreply@<host>` from it. */
  host?: string
}

/**
 * A real H3Event for work that doesn't arrive over HTTP — Nitro's `cloudflare:email` and
 * `cloudflare:scheduled` hooks hand over only `env`/`ctx`. Every server utility in this
 * app (useDb, resolveSetting, sendEmail, kvReadThrough, getCfBindings, waitUntil) reads
 * exactly `event.context.siteId`, `event.context.cloudflare.{env,context}`, and the host
 * header, so populating those makes the whole utility layer usable unchanged instead of
 * threading a second "context" type through all of it.
 *
 * Only the `node:http` *types* are imported; the req/res objects are minimal stand-ins.
 * Never pass this event to anything that reads a request body or writes a response.
 */
export function createSystemEvent(opts: SystemEventOptions): H3Event {
  const req = {
    method: 'POST',
    url: '/',
    headers: { host: opts.host ?? 'localhost' },
  } as unknown as IncomingMessage
  const event = createEvent(req, {} as ServerResponse)
  event.context.cloudflare = {
    env: opts.env as NuxFlowCloudflareEnv,
    request: new Request(`https://${opts.host ?? 'localhost'}/`),
    // Without a real ctx (tests) a waitUntil'd promise still runs, it just isn't kept alive.
    context: opts.ctx ?? { waitUntil: (p) => { void p } },
  }
  if (opts.siteId) event.context.siteId = opts.siteId
  return event
}
