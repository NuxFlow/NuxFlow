---
"@nuxflow/app": patch
---

fix: production login succeeding then immediately bouncing back to /login

Sign-in worked and correctly set a secure session cookie, but the very next page's
server-side session check (`@onmax/nuxt-better-auth`'s internal SSR self-fetch, which
runs on every page load) would silently invalidate it and redirect back to /login —
even on a hard refresh, since the failure happened server-side during SSR, not in the
browser.

Root cause: Nitro dispatches this kind of internal self-fetch without forwarding the
real `Host` header, defaulting to `localhost` — even inside a fully deployed production
Worker. `buildBetterAuthInstance()` was branching `baseURL`/cookie-protocol on the
current request's Host header, treating `localhost` as "we're in local dev" and
switching to a plain string `baseURL` that dropped the `protocol: 'https'` pinning.
That flipped Better Auth into non-secure-cookie mode for that one internal check, which
made it look for the session under the wrong cookie name, fail to find it, and clear
every session cookie — sabotaging the request that had just legitimately signed in.

Whether this is a local dev deployment is now determined once from the deployment's own
`sites` table (a local install's site domain is always `localhost`, which production
never is) instead of from any single request's Host header, so real requests and
internal self-fetches always resolve identically. Passkey origin/rpID still uses the
per-request Host for local-dev WebAuthn correctness, since passkey ceremonies only ever
originate from a genuine browser request, never Nitro's internal self-fetches — so that
part isn't exposed to the same inconsistency.
