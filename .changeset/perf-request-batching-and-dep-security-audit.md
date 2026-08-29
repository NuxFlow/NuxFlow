---
"@nuxflow/app": patch
"@nuxflow/db": patch
"@nuxflow/canvas": patch
---

Reduce D1 round trips on hot request paths, replace the Argon2 WASM hasher with a pure-JS implementation, and land a verified `better-auth` 1.7.2 upgrade with its account-identity migration.

**Performance — fewer D1 round trips**
- `server/middleware/02.multi-site.ts`: per-isolate 30s cache for the domain → site lookup (`clearSiteCache()` invalidates it on the self-healing domain-migration write), so every request no longer pays a D1 round trip just to resolve the current site.
- New `server/utils/appearance-cache.ts` and `server/utils/theme-cache.ts`: same per-isolate caching pattern for resolved appearance settings and the active theme, kept in their own modules so mutation routes can invalidate them without importing the Nitro plugin files that own the SSR injection hooks.
- `server/utils/audit.ts`: `writeAuditLog()` split into `buildAuditLogInsert()` (returns the query unexecuted) + a thin wrapper. Mutation routes across content, comments, taxonomies, menus, redirects, API keys, media folders, and memberships now fold the audit-log insert into the same `db.batch()` as the primary write instead of a separate awaited round trip.
- `server/api/public/pages/[slug].get.ts`: content-type, author, and translation-source lookups (independent of each other) now run via `Promise.all` instead of sequentially.
- `server/utils/media-providers/index.ts`: all candidate provider settings (Cloudflare Images, S3, Bunny) are resolved in parallel up front instead of one `resolveSetting()` await at a time.

**Admin UI**
- `app/pages/admin/content/index.vue` and `app/pages/admin/media/index.vue`: paginated "load more" list loading instead of fetching everything at once.

**Security / dependency audit**
- `workers/argon2-hasher`: replaced the `argon2-browser` WASM binary (unmaintained since 2022, plus a build step that reverse-engineered its minified Emscripten export names) with `@noble/hashes`'s audited pure-TS/JS Argon2id. Hash/verify round-tripped, benchmarked (~180ms at OWASP cost params), and confirmed against a live `wrangler dev` sign-in against the real database — no format change, existing password hashes keep verifying.
- `better-auth` / `@better-auth/passkey` upgraded `1.6.22` → `1.7.2`. This version scopes OAuth account identity by `(issuer, accountId)` instead of `providerId` alone — added the required `issuer` column + backfill migration (`packages/db/migrations/0004_volatile_revanche.sql`) and fixed four hand-rolled account-insert call sites (setup wizard, public `/register`, demo reset, integration-test seed helper) that were bypassing Better Auth's own account-creation API. Verified the multi-domain `trustedProxyHeaders`/`allowedHosts` setup is unaffected by 1.7's stricter default, since it already opts in explicitly.
- `@onmax/nuxt-better-auth` has been removed entirely and replaced with a hand-rolled client built directly on `better-auth`/`@better-auth/passkey` — see `CLAUDE.md`'s "Auth and permissions" section. It was never used to serve real `/api/auth/**` traffic in this app; upgrading it to its current `@nuxtjs/better-auth` successor was confirmed not to fix the `$fetch` method-literal typecheck regression it was pinned to avoid, and the regression turned out to be an unrelated, independent Nitro route-matching issue anyway (also fixed, see the same `CLAUDE.md` section).
- Removed a dead `pnpm.overrides` entry (`better-call>zod`) that no longer matched anything in the dependency tree.
- Routine version bumps: `drizzle-kit`, `ulid` (aligned across `@nuxflow/app`/`@nuxflow/db`), `@tiptap/*`, `stripe`, `wrangler`/`@cloudflare/workers-types` (argon2-hasher worker), and the Nitro `compatibilityDate`.
