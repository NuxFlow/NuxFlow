---
"@nuxflow/app": patch
---

Fix `state_mismatch` error on social login for secondary custom domains.

**Root cause:** The Better Auth instance was created once at module load time with a hardcoded `baseURL` from `NUXT_PUBLIC_SITE_URL`. OAuth callbacks on secondary domains (e.g. `customerdomain.com`) had their `redirect_uri` set to the primary domain, causing Google/GitHub to reject the state token.

**Auth fixes**
- `server/utils/better-auth.ts`: new shared utility that builds a Better Auth instance per isolate with a 5-minute TTL. In production it loads all site domains from the DB and passes `{ allowedHosts, protocol: 'https', fallback }` as `baseURL` so Better Auth resolves the correct `redirect_uri` from the incoming `Host` header on every OAuth request.
- `server/middleware/04.auth-override.ts`: new middleware that intercepts all `/api/auth/**` requests before any route handler runs, guaranteeing our instance (not the module's hardcoded one) handles every auth request.
- `server/api/auth/[...all].ts`: updated to delegate to the shared utility.
- `app/auth.config.ts`: fixed client-side `baseURL` resolution — `window.location.origin` is now checked first on the browser so the auth client on a secondary domain sends requests to that domain rather than the baked-in `NUXT_PUBLIC_SITE_URL`.

**Docs**
- `docs/installation.md`: clarify that `NUXT_PUBLIC_SITE_URL` is a `[vars]` entry in `wrangler.toml`, not a `wrangler secret put` secret; add multi-domain note to Google OAuth callback URI setup.
- `docs/multi-site.md`: new "Social login on custom domains" section explaining per-domain callback URI registration for Google and the limitation of GitHub OAuth (single callback URL per app).
