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
pnpm --filter @nuxflow/db generate   # generate migration after schema change
pnpm --filter @nuxflow/db studio     # Drizzle Studio UI at https://local.drizzle.studio
pnpm --filter @nuxflow/db migrate    # apply migrations via libSQL (Turso only)

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
themes/default/        # Default CSS theme
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

`server/middleware/multi-site.ts` resolves the current site from the `Host` header and sets:
- `event.context.siteId` — all DB queries must be scoped by this
- `event.context.siteStatus` — `'active' | 'maintenance' | 'suspended'`
- `event.context.setupCompleted`

Setup and auth routes (`/api/v1/setup`, `/api/auth`) bypass multi-site resolution.

`server/middleware/01.d1-cache.ts` ensures the module-level D1 singleton in `db.ts` is always populated before auth routes run (auth config has no per-request event access).

### Auth and permissions

Auth is handled by Better Auth via `@onmax/nuxt-better-auth`. Sessions are read server-side via `requireUserSession(event)`.

**Permission helpers** in `server/utils/permissions.ts`:
- `requireAuth(event)` → `{ userId, role }` — validates session + looks up `user_site_roles`
- `requireRole(event, minimum)` — throws 403 if role rank is below minimum
- `requireSuperAdmin(event)` — checks for a `super_admin` role entry across any site

Roles (ranked): `super_admin > admin > editor > author > member > viewer`

### Server route conventions

- Files use `[id].ts` (not `[id].js.ts`) — radix3 breaks param extraction with double extensions
- HTTP method is set via file suffix: `index.get.ts`, `index.post.ts`, `[id].patch.ts`, etc.
- All handlers validate input with Zod using `parseBody(event, schema)` or `parseQuery(event, schema)` from `server/utils/validate.ts`
- All mutations write an audit log via `writeAuditLog(event, userId, opts)` from `server/utils/audit.ts`
- IDs are generated with `ulid()` — never use `crypto.randomUUID()` or `node:crypto`
- Crypto operations (signing, hashing) use `globalThis.crypto.subtle` (Web Crypto API) — never `node:crypto`

### Cloudflare-specific utilities

`server/utils/cf-env.ts` — typed accessors for Cloudflare bindings:
- `getCfBindings(event)` → `{ kv, loader }` — `PLUGIN_KV` and `LOADER` bindings
- KV key conventions: `plugin:{siteId}:{pluginId}:server|client`, `theme:{siteId}:{themeId}:css|demo`
- `spawnPluginWorker(event, cacheId, getCode)` — spawns a dynamic plugin Worker via the `LOADER` binding

Dynamic plugins require the Cloudflare Workers Paid plan. Without it the `LOADER` binding is absent and dynamic plugins 503.

### Rate limiting

`server/utils/rate-limit.ts` — `rateLimit(event, opts)` is a two-tier check:
1. Isolate-level memory cache (instant, no DB)
2. DB upsert for cross-isolate consistency

### Plugin system

**Bundled plugins** (`packages/plugins/*`) are compiled into the Worker. Each implements `NuxFlowPlugin` from `packages/plugin-sdk/src/types.ts`, registering optional `blocks`, `adminPages`, `routes`, and `hooks`.

**Dynamic plugins** are third-party Workers stored in KV and spawned on demand. The server verifies Ed25519 signatures and SHA-256 checksums on install and on every request (`server/utils/plugin-signing.ts`).

### Theme system

Themes are CSS files stored in KV (`theme:{siteId}:{themeId}:css`). The active theme's CSS is injected as an inline `<style data-nuxflow-theme>` block during SSR via the `render:html` hook in `server/plugins/theme-resolver.ts` — no extra HTTP round-trip and no flash on first paint.

### Frontend routing

Public pages are rendered by `app/pages/[...slug].vue`. The page fetches `/api/public/pages/:slug` and branches on content type:
- `content.type === 'canvas'` → full-width `<NuxBlock>`, blocks handle their own layout
- Otherwise → contained prose layout with `<h1>` and `<NuxBlock>`

Admin pages live in `app/pages/admin/`. Pinia stores in `app/stores/` manage auth (`auth.ts`) and content (`content.ts`) state.

### Nuxt config notes

- `ssr: process.env.NODE_ENV !== 'development'` — SSR disabled in dev on Windows to work around a Named Pipe IPC crash in `@nuxt/vite-builder@4.4.2 + Vite 7.3.x`
- Nitro preset is `cloudflare-module` in production only
- `@opentelemetry/api` is stubbed via `nitro.alias` because Better Auth imports it optionally but it is not installed
- Migrations SQL files are bundled via `nitro.serverAssets`

## Commit convention

This project follows [Conventional Commits](https://www.conventionalcommits.org): `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`. Commitlint runs in CI.
