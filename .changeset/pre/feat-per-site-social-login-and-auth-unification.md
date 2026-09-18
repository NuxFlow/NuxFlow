---
"@nuxflow/app": minor
---

feat: per-site social login credentials, unified Better Auth session validation, and local-dev passkey fix

**Per-site Google/GitHub OAuth credentials**
- `server/utils/better-auth.ts` now resolves `auth.google_client_id`/`auth.google_client_secret`/`auth.github_client_id`/`auth.github_client_secret` via `resolveSetting()` (per-site DB override first, deployment-wide env var fallback second) instead of reading env vars directly — the same pattern already used for media/email/AI/payments credentials
- The Better Auth instance cache is now keyed per `Host` header (previously a single shared slot) so different sites sharing a Worker isolate never see each other's OAuth credentials, and a credential change on one site doesn't invalidate every other site's cache
- New "Social Login" card in Admin → Settings → Integrations for entering per-site Google/GitHub client ID and secret, with redirect-URI hints computed from the site's own domain
- `server/api/v1/settings/index.get.ts`/`index.patch.ts` extended to read/write the four new setting keys; secrets are masked on read and AES-GCM encrypted at rest via the existing `SENSITIVE_SETTING_KEYS` mechanism

**Auth session validation unification**
- All remaining `getUserSession`/`requireUserSession`/`serverAuth` call sites (the `@onmax/nuxt-better-auth`-provided helpers, which resolve a second, type-scaffolding-only Better Auth instance) migrated to `getAuthSession`/`requireSession` from `server/utils/auth.ts`, which are backed by the one real instance that actually serves `/api/auth/**`. Closes the last gap from the earlier session-validation-drift fix.
- Removed now-confirmed-dead code from `server/auth.config.ts` (`sendResetPassword`, `account.accountLinking`, real `socialProviders` values) — that instance never receives real auth traffic, so this logic was unreachable; only the `socialProviders` provider *keys* are kept, since the client's `signIn.social()` provider-name type is inferred from them

**Local-dev passkey origin fix**
- Passkey (WebAuthn) registration and login were silently broken in local `wrangler dev` since the dev server stopped running through `nuxt dev` on port 3000: the code's `isDev` branch relied on `NODE_ENV !== 'production'`, but `wrangler dev` always builds with `NODE_ENV=production`, and the fallback `config.public.siteUrl` resolves to workerd's own loopback bind address rather than the browser's actual origin — either one causes the browser to reject the WebAuthn ceremony with a SecurityError before any request is sent. The RP origin/rpID (and dev-mode `baseURL`) are now derived from the incoming request's own `Host` header instead.
- The per-host auth-instance cache key now uses the full `Host` header (not just the hostname) so an occasional port-less request doesn't get cached and served to later, correctly-ported requests for the rest of the 5-minute TTL.

**Misc**
- Page `<title>` order swapped to `{site name} | {page title}` (was `{page title} | {site name}`)
- `docs/multi-site.md` and `docs/installation.md` updated for per-site social login setup
