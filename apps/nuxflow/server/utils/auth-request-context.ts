import { AsyncLocalStorage } from 'node:async_hooks'
import type { H3Event } from 'h3'

/**
 * The H3Event of the /api/auth/** request Better Auth is currently handling.
 *
 * Better Auth's instance is cached per Host for 5 minutes (better-auth.ts), so the `event`
 * its config closure captured belongs to whichever request built it — using that for
 * `waitUntil` or request headers inside a hook would reach into a finished request.
 * 04.auth-override.ts runs `auth.handler()` inside `authRequestContext.run({ event })`, so
 * hooks (session.create.after, onPasswordReset) read the live event from here instead.
 * AsyncLocalStorage is native in workerd under the `nodejs_compat` flag this project sets.
 */
export const authRequestContext = new AsyncLocalStorage<{ event: H3Event }>()

export function currentAuthEvent(): H3Event | undefined {
  return authRequestContext.getStore()?.event
}
