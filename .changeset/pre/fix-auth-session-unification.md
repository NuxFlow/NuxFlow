---
"@nuxflow/app": minor
---

fix: eliminate the dual Better Auth instance that caused site-wide 401s ("Authentication required") on every protected route while `/api/auth/**` itself kept working

**Root cause:** the app has always had two separately-configured Better Auth instances — `server/utils/better-auth.ts` (hand-built, actually handles every `/api/auth/**` request and rate-limiting) and `server/auth.config.ts` (via `@onmax/nuxt-better-auth`, used only by that module's own `requireUserSession`, which every `requireAuth`/`requireRole` check went through). Each instance independently derives its own `baseURL`/protocol/cookie-naming from the request, so a session issued by one only validates correctly if the other happens to agree — which they silently stopped doing after an unrelated edit to the origin-detection logic in both files, breaking `notifications`, `settings`, `themes`, and every other protected endpoint in production while `get-session` kept returning 200.

**Fix:** added `requireSession(event)` in `server/utils/auth.ts`, backed directly by `getOrCreateBetterAuth()` — the same instance that already handles `/api/auth/**` — so there is exactly one source of truth for session validation. Repointed `requireAuth`/`requireSuperAdmin` (`permissions.ts`) and 5 direct call sites (account/subscription, memberships checkout/billing-portal, users/me) from the module's `requireUserSession` to this helper. `server/auth.config.ts` is kept only because `@onmax/nuxt-better-auth` needs it to bootstrap client-side composables (`useUserSession()` etc.); nothing server-side reads session state from it anymore, so this class of drift is no longer possible. Widened `getOrCreateBetterAuth`'s cached-instance type (it was narrowed to `{ handler }` only) so `.api.getSession()` typechecks. Added a matching `globalThis.requireSession` stub to the integration-test harness.

Also includes, from the same working session:
- `server/utils/pw.ts`: the Argon2 service-binding hasher now catches hash/verify failures and falls back to scrypt with a warning, instead of the failure propagating unhandled.
- `server/api/v1/setup/complete.post.ts`: the initial-setup path can now re-run against a domain that already has a site record (clearing previously-seeded content/settings/roles first) when the site or user table is empty, supporting a clean re-setup after a D1 wipe without deleting the database by hand.
- `docs/multi-site.md`, `CLAUDE.md`: documented the one-time setup-token link flow for adding secondary sites (introduced 2026-06-02) — previously undocumented, which was the direct cause of a support question this session. The docs now cover copying the full `?token=...` URL, why the bare domain 403s, and that a failed attempt doesn't burn the token.
