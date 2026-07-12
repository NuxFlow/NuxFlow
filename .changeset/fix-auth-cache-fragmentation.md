---
"@nuxflow/app": patch
---

fix: stop fragmenting the Better Auth instance cache by port on production domains

The per-host Better Auth instance cache introduced for per-site OAuth credentials was
keyed by the full `Host` header (including port) for every request, not just local dev.
Production's baseURL/allowedHosts computation doesn't depend on the request's exact Host
string, so this only forced unnecessary rebuilds (extra D1 round-trips) on real domains —
but during the narrow window right after a fresh site is created, those extra rebuilds
increased exposure to a D1 read-timing race, intermittently producing an `allowedHosts`
list that didn't yet include the new site's domain and causing session validation to fail
right after sign-in (login would briefly succeed, then immediately bounce back to /login).
The cache key is now hostname-only for real domains; the full host (with port) is kept
only for local `wrangler dev`, where it's actually needed for WebAuthn origin matching.
