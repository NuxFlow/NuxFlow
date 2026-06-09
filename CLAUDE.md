# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Dev server (localhost:3000, SPA mode on Windows due to Named Pipe IPC workaround)
pnpm dev

# Wrangler dev (closest to production — localhost:8787, D1 auto-provisioned)
cd apps/nuxflow && wrangler dev

# Unit tests (Vitest)
pnpm test                          # all packages
pnpm --filter @nuxflow/app test    # app only
pnpm --filter @nuxflow/app test:watch

# E2E tests (Playwright, requires running dev server)
pnpm test:e2e

# Type check and lint
pnpm typecheck
pnpm lint

# Database
pnpm --filter @nuxflow/db generate      # generate migration after schema change
pnpm --filter @nuxflow/db studio        # Drizzle Studio UI at https://local.drizzle.studio
pnpm --filter @nuxflow/db migrate       # apply migrations via libSQL (Turso only)
pnpm --filter @nuxflow/db migrate-fts   # apply FTS5 search index separately on Turso

# Build and deploy
pnpm build
pnpm deploy   # wrangler deploy from apps/nuxflow
```

**Always use `pnpm`, never `npm`.**

## Architecture

### Monorepo layout

```
apps/nuxflow/          # Main Nuxt 4 app (the CMS)
packages/db/           # Drizzle schema, migrations, client factory
packages/plugin-sdk/   # Plugin authoring types (NuxFlowPlugin, PluginBlock, etc.)
packages/plugins/      # Bundled plugins: canvas, contact-form, payments, html-block
packages/cli/          # `nuxflow` CLI — scaffold, build, and deploy dynamic plugins/themes
themes/default/        # Default CSS theme
docs/                  # User-facing documentation (markdown)
```

`packages/db` is linked as a workspace dep; schema changes in `packages/db/src/schema/` are immediately visible to the app with no build step.

### Database layer

`packages/db/src/client.ts` — libSQL/Turso client factory (`createDb`).

`apps/nuxflow/server/utils/db.ts` — `useDb(event)` returns a Drizzle instance backed by either:
- Cloudflare D1 binding (`event.context.cloudflare.env.DB`) — used in production
- Turso/libSQL (`NUXT_TURSO_URL`) — used in local dev and Option C setup

Both share the same Drizzle schema so queries are identical. D1 is preferred and detected first.

**Migrations run automatically** on cold start via `server/middleware/00.migrate.ts`. SQL files are bundled into the Worker as server assets (`packages/db/migrations/`). Never hand-run migrations in production; just deploy. For schema changes: edit `packages/db/src/schema/*.ts`, run `pnpm --filter @nuxflow/db generate`, commit both the schema and the generated SQL.

Schema files in `packages/db/src/schema/`:

| File | Tables |
|---|---|
| `sites.ts` | `sites`, `site_settings` |
| `users.ts` | users, sessions, accounts, `user_site_roles` |
| `content.ts` | `content_types`, `content_items`, `content_revisions`, taxonomies |
| `media.ts` | media, folders |
| `forms.ts` | forms, submissions |
| `payments.ts` | membership tiers, subscriptions |
| `system.ts` | plugins, themes, audit logs, webhooks, `rate_limits` |

### Multi-site and request context

`server/middleware/02.multi-site.ts` resolves the current site from the `Host` header and sets:
- `event.context.siteId` — all DB queries must be scoped by this
- `event.context.siteStatus` — `'active' | 'maintenance' | 'suspended'`
- `event.context.setupCompleted`

**Single-site fallback:** if no site matches the incoming domain but exactly one site exists in the database, that site is used. In production this also self-heals by updating the stored domain to match the live request host — so sitemaps, invite links, and RSS feeds automatically correct after a domain migration.

**Adding additional sites:** the initial setup wizard (`/api/v1/setup/complete`) blocks with 409 if any site already exists — it is a one-time first-install flow only. Additional sites must be created via the super admin panel at `/admin/super/sites`. Sites created this way are blank shells with no seeded content types, homepage, or users; the super admin must configure them manually.

Setup and auth routes (`/api/v1/setup`, `/api/auth`) bypass multi-site resolution.

`server/middleware/01.d1-cache.ts` ensures the module-level D1 singleton in `db.ts` is always populated before auth routes run (auth config has no per-request event access).

### Auth and permissions

Auth is handled by Better Auth via `@onmax/nuxt-better-auth`. Sessions are read server-side via `requireUserSession(event)`.

**Permission helpers** in `server/utils/permissions.ts`:
- `requireAuth(event)` → `{ userId, role }` — validates session + looks up `user_site_roles` for the **current site**
- `requireRole(event, minimum)` — throws 403 if role rank is below minimum; **site-scoped**
- `requireSuperAdmin(event)` — checks for a `super_admin` role entry on **any site**, not just the current one

This cross-site vs site-scoped distinction matters: a super admin on site A automatically has super admin access when visiting site B's domain, but their effective role for content operations on site B defaults to `viewer` unless a `user_site_roles` row exists for that site.

`GET /api/v1/users/me` — returns `{ role, isSuperAdmin }` for the authenticated user. This is the only client-side way to get role information; the session object from `useUserSession()` only contains the users table fields.

Roles (ranked): `super_admin > admin > editor > author > member > viewer`

**API key auth** — `server/middleware/03.api-key-auth.ts` handles `Authorization: Bearer <key>` requests. On a valid key it sets `event.context.apiKeyUserId` and `event.context.apiKeyRole` (derived from `user_site_roles` for the current site). Routes that want to support headless API access should check these context fields in addition to session auth.

### Server route conventions

- Files use `[id].ts` (not `[id].js.ts`) — radix3 breaks param extraction with double extensions
- HTTP method is set via file suffix: `index.get.ts`, `index.post.ts`, `[id].patch.ts`, etc.
- All handlers validate input with Zod using `parseBody(event, schema)` or `parseQuery(event, schema)` from `server/utils/validate.ts`
- All mutations write an audit log via `writeAuditLog(event, userId, opts)` from `server/utils/audit.ts`
- IDs are generated with `ulid()` — never use `crypto.randomUUID()` or `node:crypto`
- Crypto operations (signing, hashing) use `globalThis.crypto.subtle` (Web Crypto API) — never `node:crypto`
- Use response helpers from `server/utils/response.ts`: `ok(data)`, `created(event, data)`, `noContent(event)`, `notFound()`, `forbidden()`, `conflict()`, `validationError()` — do not throw raw `createError` for these common cases

### Cloudflare-specific utilities

`server/utils/cf-env.ts` — typed accessors for Cloudflare bindings:
- `getCfBindings(event)` → `{ kv, loader }` — `PLUGIN_KV` and `LOADER` bindings
- KV key conventions: `plugin:{siteId}:{pluginId}:server|client`, `theme:{siteId}:{themeId}:css|demo`
- `spawnPluginWorker(event, cacheId, getCode)` — spawns a dynamic plugin Worker via the `LOADER` binding

Dynamic plugins require the Cloudflare Workers Paid plan. Without it the `LOADER` binding is absent and dynamic plugins 503.

**`wrangler.toml` config notes:** custom domains must be declared via `[[routes]]` with `custom_domain = true` — if a domain is configured in the Cloudflare dashboard but not in `wrangler.toml`, Wrangler will warn about config drift and offer to remove it on every deploy. The `[assets]` section serves static files from `.output/public` and must be present for the built frontend to be served.

### Rate limiting

`server/utils/rate-limit.ts` — `rateLimit(event, opts)` is a two-tier check:
1. Isolate-level memory cache (instant, no DB)
2. DB upsert for cross-isolate consistency

### Settings system

`server/utils/settings.ts` — `resolveSetting(event, key, envKey?)` reads a site setting: DB first, falls back to `runtimeConfig[envKey]`. `saveSetting(event, key, value)` writes it. Keys listed in `SENSITIVE_SETTING_KEYS` (API keys, passwords) are automatically encrypted with AES-GCM using `betterAuthSecret` before writing and decrypted on read — never store or compare these in plaintext. There is a 30 s in-memory cache per isolate to avoid redundant DB reads; the cache is cleared automatically on save.

### Email

`server/utils/email.ts` — `sendEmail(event, msg)` dispatches email through the provider configured in site settings. Supported providers: `resend`, `brevo`, `zepto`, `smtp` (relayed via MailChannels in Workers). Defaults to `console` log in dev when no provider is configured. Use `sendNotification()` from `server/utils/notify.ts` to persist an in-app notification and optionally send email in one call.

### AI providers

`server/utils/ai-sdk.ts` — `getAiSdkModel(event, quality)` returns an AI SDK `LanguageModel` for the provider configured in site settings (`ai.provider`). Supported providers: `openai`, `anthropic`, `gemini`, `deepseek`, `ollama`. Quality is `'fast'` (default) or `'smart'`, which selects a smaller vs larger model per provider. Returns `null` when the provider API key is missing — callers are expected to throw 503 on `null`. Use `aiErrorMessage(err)` to extract a user-friendly message from provider SDK errors.

### Plugin system

**Bundled plugins** (`packages/plugins/*`) are compiled into the Worker. Each implements `NuxFlowPlugin` from `packages/plugin-sdk/src/types.ts`, registering optional `blocks`, `adminPages`, `routes`, and `hooks`.

**Dynamic plugins** are third-party Workers stored in KV and spawned on demand. The server verifies Ed25519 signatures and SHA-256 checksums on install and on every request (`server/utils/plugin-signing.ts`).

**CLI** (`packages/cli`) — the `nuxflow` CLI is used by third-party plugin/theme authors:
- `nuxflow plugin create` — scaffold a new dynamic plugin
- `nuxflow plugin keygen` — generate an Ed25519 publisher keypair (private key stays local, public key embedded in `nuxflow.plugin.json`)
- `nuxflow plugin build` — bundle `src/server.ts` + `src/client.ts` to `dist/plugin.json`
- `nuxflow plugin deploy --site <url>` — sign and install a plugin on a live site
- `nuxflow plugin update --site <url>` — remove old version and reinstall
- `nuxflow theme` — analogous commands for custom themes

### Theme system

Themes are CSS files stored in KV (`theme:{siteId}:{themeId}:css`). The active theme's CSS is injected as an inline `<style data-nuxflow-theme>` block during SSR via the `render:html` hook in `server/plugins/theme-resolver.ts` — no extra HTTP round-trip and no flash on first paint.

`server/plugins/site-settings-resolver.ts` injects appearance settings into SSR HTML on the same hook:
- `theme.dark_mode` → blocking inline `<script>` that adds/removes the `dark` class before paint
- `theme.primary_color` → `--nuxflow-primary` CSS custom property (injected everywhere, including admin)
- `theme.font_sans` → `--nuxflow-font` CSS property + Google Fonts `<link>`; `'system'` skips injection

Admin pages skip dark-mode and font injection (the admin has its own colour-mode toggle).

### Security utilities

`server/utils/security.ts` — use these for any endpoint that fetches external URLs or processes archives:
- `isSafeUrl(urlStr)` — SSRF guard; returns `false` for private/loopback IPv4, private IPv6, `localhost`, `.local`, `.internal`, and non-HTTP(S) schemes
- `validateZipArchive(data, maxUncompressedSize)` — parses the ZIP central directory without decompressing; throws 400 on path traversal (Zip Slip) and 413 on Zip Bomb; returns `{ fileCount, totalSize }`

### Frontend routing

Public pages are rendered by `app/pages/[...slug].vue`. The page fetches `/api/public/pages/:slug` and branches on content type:
- `content.type === 'canvas'` → full-width `<NuxBlock>`, blocks handle their own layout
- Otherwise → contained prose layout with `<h1>` and `<NuxBlock>`

Admin pages live in `app/pages/admin/`. Super-admin-only pages (e.g. multi-site management) live under `app/pages/admin/super/` and are linked in the sidebar only when `/api/v1/users/me` returns `isSuperAdmin: true`. Pinia stores in `app/stores/` manage auth (`auth.ts`) and content (`content.ts`) state.

### Nuxt config notes

- `ssr: process.env.NODE_ENV !== 'development'` — SSR disabled in dev on Windows to work around a Named Pipe IPC crash in `@nuxt/vite-builder@4.4.2 + Vite 7.3.x`
- Nitro preset is `cloudflare-module` in production only
- `@opentelemetry/api` is stubbed via `nitro.alias` because Better Auth imports it optionally but it is not installed
- Migrations SQL files are bundled via `nitro.serverAssets`

## Commit convention

This project follows [Conventional Commits](https://www.conventionalcommits.org): `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`. Commitlint runs in CI.

## Git & Deployment Workflow

Before staging, committing, or pushing any changes to GitHub, **always** perform the following verification steps locally:
1. **Linter**: Run `pnpm lint` and ensure there are 0 ESLint errors.
2. **Typecheck**: Run `pnpm typecheck` and ensure the TypeScript compiler is 100% green.
3. **Unit Tests**: Run `pnpm test` to guarantee zero regressions on serverless routes or business logic.
4. **E2E Tests**: If modifying critical dashboard forms or routing logic, run E2E specs to ensure Edge Worker compatibility.
