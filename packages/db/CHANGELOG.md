# @nuxflow/db

## 2.0.0-beta.5

### Patch Changes

- 931f3a6: feat: pre-release security, correctness, and Cloudflare-native architecture audit

  A full audit pass across the codebase before first release, covering security, payments correctness, data integrity, and making better use of Cloudflare-native primitives. Grouped by area:

  **Security**

  - `02.multi-site.ts`'s domain self-heal (auto-updates a site's stored domain to match the live request host) now requires an authenticated admin+ session on that site — previously any unauthenticated request to `/admin/*` with a forged `Host` header could silently hijack a site's domain on a Worker with no custom-domain route configured.
  - `setup/complete.post.ts`'s secondary-site token claim is now one atomic conditional `UPDATE ... WHERE setupTokenHash = ?` instead of a read-then-write — closes a race where two concurrent requests holding the same (e.g. leaked) token could both become `super_admin`.
  - New `safeFetch()` / `resolvesToPrivateIp()` in `security.ts` — resolves a URL's hostname via DNS-over-HTTPS and re-validates on every redirect hop before the WordPress importer or backup media-fetch paths touch it, closing a DNS-rebinding gap in `isSafeUrl()` (which only inspected the literal hostname string).
  - `00.migrate.ts`'s migration-lock loser now polls for the winner to actually finish (bounded) instead of assuming success after ~1s and serving requests against a possibly-unmigrated schema.
  - `exif.ts`'s accessor helpers (`rational`/`getShort`/`getLong`/`getRational`) are now bounds-checked by construction — previously safe only because the one caller happened to wrap the call in try/catch.

  **Payments correctness**

  - The public content gate now requires `currentPeriodEnd > now()` in addition to `status = 'active'` — access no longer outlives a stalled or dropped webhook (a failed card during dunning used to leave full access indefinitely).
  - `upsertSubscriptionFromWebhook` is now one atomic `INSERT ... ON CONFLICT DO UPDATE`, backed by a new unique index on `subscriptions(site_id, provider, provider_subscription_id)` — closes a race where two webhook deliveries for the same checkout (Stripe always sends both `checkout.session.completed` and `customer.subscription.created`) could create duplicate subscription rows and double-send the activation push.
  - Stripe's secondary subscription-details fetch now throws (502) instead of silently swallowing a failure and returning 200 — Stripe will retry a transient failure properly now instead of it being lost.

  **Rate limiting**

  - Replaced the two-tier (isolate-memory + KV-or-D1 read-then-write) rate limiter with a single atomic `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` against D1 — closes a TOCTOU race where concurrent requests for the same key could all read the same pre-increment count before any write landed, letting the effective limit be exceeded by roughly the number of in-flight requests every window. Isolate memory is now purely a fast-fail cache for already-confirmed-blocked keys, not the source of truth.

  **Cloudflare-native architecture**

  - New `R2Provider` (`media-providers/r2.ts`) — Cloudflare's own object storage, zero egress fees, no third-party account, accessed via an optional `MEDIA_BUCKET` bucket binding. Slotted into `getActiveProvider()`'s priority chain right after Cloudflare Images. Configurable in Settings → Media.
  - Theme CSS is now stored under a versioned KV key (`themes.cssVersion`, bumped atomically on every publish) instead of a fixed one — closes a staleness window where a publish could take up to ~2 minutes to become visible everywhere, from isolate-local CSS caching compounding with KV's own eventual-consistency propagation lag. Includes a backward-compatible fallback to the pre-versioning key so themes published before this change don't go dark.
  - The dynamic-plugin WorkerLoader cache key is now the plugin's stored code checksum instead of its free-text version string — a code-only fix shipped via `nuxflow plugin update` without a version bump now actually takes effect instead of continuing to serve stale cached code.
  - New hourly `reconcile-stuck-videos` task sweeps `video_assets` rows stuck at `status: 'processing'` past a 2-hour TTL; the video registration endpoint now requires a real successful Cloudflare Stream lookup before inserting a row at all, instead of silently inserting one that could never leave that state.

  **Data integrity**

  - New unique index on `content_taxonomy_terms(content_item_id, term_id)` — nothing previously stopped a duplicate assignment from double-counting an item in taxonomy archives.
  - `rate_limits` and `notifications` are now swept by the nightly `prune-old-data` task (previously unbounded).
  - Content autosave no longer snapshots a revision when title/content didn't actually change; `GET .../revisions` is now capped at 50 results.
  - Backup/restore now routes settings through `saveSetting()` (fixes stale-cache and broken re-encryption-on-restore bugs from bypassing it) and batches the content-restore existence checks into one query instead of one per item.
  - `sitemap.xml` / `sitemap-images.xml` are now bounded instead of unbounded.
  - The FTS5 `search_index` update trigger now only fires its reindex on the columns that actually affect it (title/excerpt/status/visibility), instead of on every single content edit.
  - Fire-and-forget notifications in `contact/submit` and `content/[id].patch` now use `ctx.waitUntil()` instead of risking silent cancellation when the isolate is reused before they finish.

  **Frontend bundle size**

  - The admin page-builder editor (`CanvasContentEditor`, pulling in `vuedraggable` and friends) is now a lazy async component instead of shipping to every public-page visitor via a universal client plugin.
  - `highlight.js` (core + 11 language grammars) now loads only when a page actually has a code block, instead of eagerly on every navigation.
  - `CanvasBlockImage` now lazy-loads, matching its `CanvasBlockGallery` sibling.
  - `feed.xml`'s hand-rolled TipTap serializer now blocks `javascript:`/`vbscript:`/`data:` URL schemes in links and images, matching the sanitization the canonical web renderer already had — closes a gap where a malicious link/image URL was neutralized on the page but passed through unmodified into the RSS feed.

  **Also fixed**: a block-registry regression introduced (and caught before release) during this same pass, where a collision guard meant to stop a plugin from squatting a built-in block id also rejected the built-ins' own bootstrap registration — every block on every page fell back to its loading skeleton. `register()` now only rejects an id that's _already_ registered, relying on built-ins always registering first (synchronously, at boot) to win that race.

## 2.0.0-beta.4

### Patch Changes

- 07eeb51: Reduce D1 round trips on hot request paths, replace the Argon2 WASM hasher with a pure-JS implementation, and land a verified `better-auth` 1.7.2 upgrade with its account-identity migration.

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
  - `@onmax/nuxt-better-auth` stays pinned to its `alpha` dist-tag — the `0.1.2` stable release has a confirmed typecheck regression unrelated to auth itself (breaks `$fetch` method-literal inference for any API route with a `GET` handler co-located with other methods at the same path). See `CLAUDE.md`'s "Auth and permissions" section for the full investigation and what's blocking the bump.
  - Removed a dead `pnpm.overrides` entry (`better-call>zod`) that no longer matched anything in the dependency tree.
  - Routine version bumps: `drizzle-kit`, `ulid` (aligned across `@nuxflow/app`/`@nuxflow/db`), `@tiptap/*`, `stripe`, `wrangler`/`@cloudflare/workers-types` (argon2-hasher worker), and the Nitro `compatibilityDate`.

## 2.0.0-beta.3

### Patch Changes

- ff1aa18: refactor: standardize server API error/validation helpers, add missing audit logs, and remove dead code

  Server API routes now consistently use the existing `response.ts` helpers (`notFound`, `forbidden`, `conflict`, etc.) instead of hand-rolled `createError()` calls, and the existing `parseBody`/`parseQuery` Zod helpers instead of `readValidatedBody(event, schema.parse)` — the latter previously surfaced bad input as an unhandled 500 instead of a clean 422. Thirteen mutation routes (taxonomies, comments, API keys, redirects, menus, media folders, memberships) that were silently skipping the audit log now write one, matching their sibling routes.

  Extracted repeated Drizzle query patterns into shared helpers: `getContentItemOrThrow`/`getContentTypeBySlugOrThrow` in `server/utils/content-queries.ts`, `getUserSiteRole` in `permissions.ts`, and `parsePagination` in `server/utils/pagination.ts` — the last of which also fixes a real bug where `forms/[id]/submissions.get.ts` was missing the `page >= 1` guard the other paginated endpoints had, producing a negative DB offset on `page=0` or negative. `contact/submit.post.ts` now reads its notification email through `resolveSetting()` instead of a raw query that bypassed the settings cache and decryption path.

  Also removed dead code found during the audit: an unused Pinia `useContentStore`, an orphaned/stale `searchIndexSql` export duplicating the real FTS5 migration, and an unused `canvasManifest` export in `@nuxflow/canvas`. Consolidated the duplicated block-definition fallback chain (`getBlockDefinition() ?? registry.getDefinition()`, which had already drifted between call sites) into one `resolveDefinition()` helper shared by `useCanvas.ts` and `NuxBlocks.vue`, and merged the app's `NuxBlockData` type with `@nuxflow/canvas`'s `CanvasBlockData` instead of maintaining two identical shapes by hand.

## 2.0.0-beta.2

### Patch Changes

- e4d1b14: refactor: eliminate fake "bundled plugins", promote canvas blocks to core, squash migrations

  **Architecture cleanup — bundled plugins removed**

  - Deleted `packages/plugins/` entirely (contact-form, html-block, payments, and the old canvas copy)
  - Canvas package moved from `packages/plugins/canvas` to `packages/canvas` and renamed `@nuxflow/plugin-canvas` → `@nuxflow/canvas`
  - "Plugin" in the codebase now means exactly one thing: a signed, independently-installable dynamic Cloudflare Worker extension

  **Canvas block categories**

  - Removed `'plugin'` category; added `'forms'`, `'advanced'`, and `'commerce'` categories
  - Contact Form block promoted to `CANVAS_BLOCKS` under `'forms'`
  - HTML Block promoted to `CANVAS_BLOCKS` under `'advanced'`
  - Membership Pricing block promoted to `CANVAS_BLOCKS` under `'commerce'`
  - Block picker "Plugins" section renamed "Extensions"; only appears when true dynamic plugin blocks are installed

  **CLI scaffold template**

  - `BlockDefinition.category` updated to reflect new category set (removed `'plugin'`, added `'forms'|'advanced'|'commerce'`)
  - Example block defaults to `'advanced'` category

  **create-nuxflow-app — Linux install fix**

  - Build output moved from `dist/` to `bin/` (not gitignored)
  - `bin/index.js` is now committed so `pnpm install` inside a freshly scaffolded project can link the bin without requiring a `prepare` run first

  **DB migrations squash**

  - Migrations 0001–0008 collapsed into `0000_baseline.sql` with all `ALTER TABLE` columns folded into their `CREATE TABLE` statements
  - Clean starting point for beta

## 2.0.0-beta.1

### Minor Changes

- 6c9590c: Add editorial calendar and scaffold event fields for future events system.

  - New `/admin/calendar` page with month-view grid, colour-coded content chips by status (published/scheduled/draft/review/archived), month navigation, and click-through to the content editor
  - New `GET /api/v1/content/calendar` endpoint accepting `from`/`to` date params; returns content items grouped by their publication or scheduled date
  - Calendar link added to admin sidebar between Content and Taxonomies
  - `content_items` table gains five nullable event scaffold columns (`event_start_at`, `event_end_at`, `event_location`, `event_url`, `event_all_day`) and an index on `(site_id, event_start_at)` for efficient date-range queries (migration 0006)
  - Events System section added to roadmap documenting the full planned feature and what groundwork is already in place

- bd1d5bd: Add web push notifications (VAPID) for real-time in-app alerts.

  **Server**

  - `server/utils/webpush.ts`: full VAPID implementation using Web Crypto API (no Node.js dependencies) — key generation, subscription management, and RFC 8291 encrypted payload delivery.
  - `server/api/v1/push/`: eight new endpoints: `vapid-public-key.get`, `vapid-keys.post` (generate/rotate keys), `subscribe.post`, `unsubscribe.delete`, `status.get`, `subscribers.get`, `broadcast.post`, `test.post`.
  - `server/utils/notify.ts`: `sendNotification()` now broadcasts a web push alongside the in-app notification when the site has VAPID keys configured.
  - `server/utils/settings.ts`: add `push.vapid_public_key` and `push.vapid_private_key` to `SENSITIVE_SETTING_KEYS` for encrypted-at-rest storage.
  - Push triggers wired into `contact/submit.post.ts`, `content/[id].patch.ts`, and `memberships/webhooks/[provider].post.ts`.

  **Frontend**

  - `app/composables/usePushNotifications.ts`: composable that wraps the Push API, handles permission requests, subscribes/unsubscribes, and tracks state.
  - `app/components/public/PushNotificationBanner.vue`: opt-in banner rendered on public pages.
  - `app/layouts/default.vue`: mount the banner in the default layout.
  - `app/pages/account.vue`: push notification toggle in the user account settings.
  - `app/pages/admin/settings/index.vue`: VAPID key management and broadcast UI in Admin → Settings → Notifications.
  - `public/sw.js`: service worker that handles `push` events and renders notifications via the Notifications API.

  **Database**

  - `packages/db/src/schema/system.ts`: new `push_subscriptions` table (`id`, `siteId`, `userId`, `endpoint`, `p256dh`, `auth`, `createdAt`).
  - Migration `0001_simple_sprite.sql`: `CREATE TABLE push_subscriptions` applied automatically on next deploy.

- fe571be: feat: SEO enhancements — canonical URL, focus keyword, meta robots, Google snippet preview, schema.org JSON-LD, and improved robots.txt/sitemap
- 058ca48: Add Cloudflare Stream video support, membership tier management, canvas block improvements, and wrangler dev build automation.

  **Cloudflare Stream / video**

  - `app/pages/admin/media/videos.vue`: dedicated Videos tab in the media library with TUS resumable upload support.
  - `server/api/v1/media/video/`: new video API endpoints for upload URL generation, list, and delete via the Cloudflare Stream API.
  - `packages/db/src/schema/media.ts`: add `videoAssets` table for tracking Stream-hosted videos.
  - Migrations `0002` and `0003`: schema additions applied automatically on next deploy.

  **Membership / billing**

  - `server/api/v1/memberships/index.post.ts`: create membership tiers with Stripe product and price creation.
  - `server/api/v1/memberships/[id].patch.ts`: update tier metadata and sync changes to Stripe.
  - `server/api/v1/memberships/checkout.post.ts`: Stripe Checkout session creation with configurable success/cancel URLs.
  - `server/api/v1/memberships/billing-portal.post.ts`: Stripe Customer Portal session creation.
  - `server/api/v1/memberships/webhooks/[provider].post.ts`: full Stripe webhook handling for subscription lifecycle events.
  - `packages/plugins/payments/src/providers/stripe.ts`: shared Stripe client helpers.
  - `packages/plugins/payments/src/components/MembershipsAdmin.vue`: tier CRUD UI with Stripe sync status.
  - `packages/plugins/payments/src/components/Paywall.vue`: subscription-aware paywall with portal link.

  **Canvas blocks**

  - `CanvasBlockGdpr.vue`: complete overhaul — consent state machine, cookie categories, granular accept/reject controls.
  - `CanvasBlockImage.vue`: lazy loading, aspect-ratio preservation, and Cloudflare Images URL transformation.
  - `CanvasBlockVideo.vue`: Stream iframe embed with poster and autoplay controls.
  - `definitions.ts`: updated block schemas for GDPR, image, and video blocks.
  - `themes/default/components/blocks/Image.vue`: matching image block improvements in the default theme.

  **Content editor**

  - `ContentEditor.client.vue`: image insertion from the media library, link editing, and table support.

  **Admin UI**

  - `app/pages/admin/settings/index.vue`: expanded settings page with Stream, Stripe, and email provider sections.
  - `app/components/admin/Sidebar.vue`: Videos link in the media section.
  - `app/pages/admin/media/index.vue`: media library layout and filter improvements.

  **Tests**

  - New integration test suite: `billing-portal`, `checkout`, `media-patch`, `memberships-tiers`, `video-assets`, `webhooks`.
  - New unit test: `canvas-blocks.test.ts` covering all block definition schemas.
  - Test helpers (`event.ts`, `globals.ts`, `seed.ts`): expanded fixtures for membership and media scenarios.

  **Developer experience**

  - `wrangler.toml` / `wrangler.toml.example`: add `[build] command = "pnpm run build"` so `wrangler dev` compiles the Nuxt app automatically on first run — no separate build step required.
  - `docs/installation.md`: document the auto-build behaviour and note that source changes require a restart.

- b8b1b2c: Add Visual Customizer, content gating with Cache-Control, multi-provider payments, and theme system hardening.

  **Visual Customizer**

  - `app/pages/admin/themes/customize.vue`: new live-preview theme editor — accent colour, link colour, body/heading font, font size, heading weight, line height, border radius, and colour mode (light/dark/auto).
  - `server/api/v1/themes/customizer.get.ts`: returns current customizer values and the ID of the active customizer theme for the site.
  - `server/api/v1/themes/customizer.post.ts`: validates and saves customizer values to site settings; combines customizer CSS variables with the active bundled theme's structural CSS before writing to KV — so panel layouts and visual chrome from the bundled theme are preserved on every publish.
  - `app/plugins/theme-preview-listener.client.ts`: listens for `postMessage` events from the customizer iframe and applies CSS variables to the preview document in real time without a round-trip to the server.
  - `app/pages/admin/themes/index.vue`: "Customize" button links through to the new customizer page.

  **Theme system hardening**

  - `server/plugins/theme-resolver.ts`: added admin guard — theme CSS is no longer injected into `/admin/*` pages, preventing user-defined fonts and colours from overriding the admin dashboard UI.
  - `server/plugins/site-settings-resolver.ts`: `--nuxflow-primary` and the dark-mode blocking script continue to apply to all pages including admin for nav-bar highlights; font and custom-code injection are already admin-guarded.
  - Bundled theme packages (`nuxflow-marketing-site`, `nuxflow-marketing-landing`): replaced all hardcoded `#00dc82` and `rgba(0,220,130,…)` values with `var(--nuxflow-primary, #00dc82)` and `color-mix(in srgb, var(--nuxflow-primary, …) X%, transparent)` so the Visual Customizer's accent colour control takes full effect; also wired body font to `var(--nuxflow-font, …)` and link colour to `var(--nuxflow-link, …)`. Both ZIP bundles rebuilt.

  **Content gating and Cache-Control**

  - `server/api/public/pages/[slug].get.ts`: HTTP 402 with `{ gated, requiredTier, tiers }` when content requires a subscription the caller does not hold; `Cache-Control: private, no-store` on member-only responses; `Cache-Control: public, max-age=3600, stale-while-revalidate=86400` on public responses.
  - `server/utils/payments/gate.ts`: `resolveContentGate(event, settings)` checks `settings.access` (`'public'`, `'members'`, `'tier:<id>'`) against the caller's active subscription. Returns `GateResult | null` (null = access granted).
  - `app/pages/[...slug].vue`: `onResponseError` handler catches the 402 and renders `<Paywall :tiers="gated.tiers" />` instead of the page content.

  **Multi-provider payment system (moved to core)**

  - `server/utils/payments/stripe.ts`: Stripe provider — products, prices, checkout sessions, billing portal, subscription cancel, webhook event construction.
  - `server/utils/payments/lemonsqueezy.ts`: LemonSqueezy provider — products, variants, checkout, portal, cancellation, webhook HMAC verification.
  - `server/utils/payments/paddle.ts`: Paddle Classic provider with analogous interface.
  - `server/api/v1/memberships/`: checkout, billing-portal, webhooks, tier CRUD, and tier patch endpoints updated to use the new provider abstraction.
  - `server/api/v1/account/subscription.delete.ts`: cancel the caller's active subscription; skips provider API for free-tier subs whose `providerSubscriptionId` starts with `free_`.
  - `app/components/memberships/Paywall.vue`: subscription-aware paywall with upgrade CTA and portal link.
  - `app/components/memberships/MembershipsAdmin.vue`: tier CRUD UI.
  - `app/pages/account.vue`: subscription management page — active plan, billing portal link, cancel flow.
  - `packages/plugins/payments/src/index.ts`: simplified to a deprecated stub kept for workspace compatibility; functionality lives in `server/utils/payments/`.

  **Contact form and HTML block (moved to core)**

  - `app/components/forms/ContactFormAdmin.vue`, `ContactFormBlock.vue`: contact form UI components moved into the main app so they render without the plugin being active.
  - `app/components/blocks/HtmlBlock.vue`: HTML block renderer moved to core.
  - `packages/plugins/contact-form/src/index.ts`, `packages/plugins/html-block/src/index.ts`: simplified to plugin registration stubs; component logic lives in the app.

  **Analytics**

  - `server/utils/analytics.ts`: `trackPageView(event, { siteId, slug })` writes to the Cloudflare Analytics Engine binding; no-ops silently when the binding is absent. Called automatically from the public pages API.

  **DB schema (migrations 0004 and 0005)**

  - `packages/db/src/schema/content.ts`: additional content type metadata columns.
  - `packages/db/src/schema/system.ts`: `rate_limits` table and extended plugin/audit columns.
  - Migrations applied automatically on first request after deployment.

  **Canvas**

  - `packages/plugins/canvas/src/blocks/CanvasBlockFooter.vue`: layout and link colour fixes.

  **Integration tests**

  - `tests/integration/customizer.test.ts`: publish flow, base-theme layering, re-publish idempotency.
  - `tests/integration/public-site.test.ts`: public page fetch, 402 for gated content, Cache-Control headers.
  - `tests/integration/subscription-cancel.test.ts`: cancel flow for paid and free-tier subscriptions.
  - `tests/integration/pages-access.test.ts`: Cache-Control ordering fix — tests that depend on a seeded subscription now run after the subscription is created.

  **Documentation and developer experience**

  - `docs/installation.md`: corrected Cloudflare deploy command to `cd apps/nuxflow && pnpm run deploy` (Wrangler's `[build]` section handles the Nuxt build automatically; the previous `pnpm deploy` from the repo root conflicted with Turbo's own build step).
  - `docs/payments-setup.md`: new guide covering Stripe, LemonSqueezy, and Paddle setup including webhook endpoints and required secrets.
  - `docs/roadmap.md`: public roadmap.
  - `docs/user-guide.md`: Visual Customizer, content gating, membership management, and account page sections.
  - `CLAUDE.md`: updated deploy command reference.

### Patch Changes

- 1859470: feat: Argon2id password hashing, public footer/sidebar, and major dependency upgrades

  **Security — Argon2id password hashing**

  - New `workers/argon2-hasher` Cloudflare Worker: imports `argon2.wasm` statically at build time, exposes `hash` and `verify` via a service binding (`ARGON2`)
  - New `server/utils/pw.ts`: `nuxflowPasswordHasher` adapter that routes to the Argon2 binding in production and falls back to `node:crypto` scrypt in local dev
  - Better Auth `emailAndPassword.password` and setup `complete.post.ts` now use `nuxflowPasswordHasher` instead of `better-auth/crypto`
  - New `ArgonHasherBinding` type in `server/types/cloudflare-bindings.d.ts`
  - New `docs/security.md` documenting algorithm parameters and the rationale for the separate Worker architecture

  **Public layout — footer and sidebar**

  - New `PublicSiteFooter.vue`: footer navigation driven by the `footer` menu slot, hidden when the menu has no items
  - New `PublicSiteSidebar.vue`: sticky right-rail sidebar driven by the `sidebar` menu slot, hidden on mobile and when empty
  - `default.vue` layout updated to a flex-column structure that accommodates both new components

  **Setup improvements**

  - Setup wizard no longer accepts a `domain` field — the site domain is derived from the request `Host` header, eliminating the mismatch between form input and actual hostname
  - Secondary site setup (pre-created by super admin) simplified: lookup is by request host only, fallback by form domain removed
  - Menu item schema: `id` and `type` made optional so newly created items that haven't been persisted yet pass validation

  **Settings cleanup**

  - Google Analytics measurement-ID field removed from Admin → Settings → Integrations (the `integrations.analytics_id` setting key is no longer saved or loaded)

  **Dependency upgrades**

  - Vitest 3 → 4: class mock factories migrated from arrow functions to `function`/`class` syntax; `poolOptions.forks.singleFork` replaced with `maxWorkers: 1`
  - Zod 3 → 4: `z.record()` calls updated to two-arg form `z.record(z.string(), ...)` across all server routes; `schema._type` references replaced with `z.infer<typeof schema>`
  - `@nuxtjs/i18n` 9 → 10: removed `restructureDir: false` (type changed to string-only) and `lazy: true` (now default); `langDir` set to absolute path
  - `ai` 6 → 7, `@ai-sdk/openai/anthropic/google` 3 → 4, `openai` 4 → 6: no API changes required
  - `ulid` 2 → 3: drop-in replacement, no changes required
  - `stripe` 17 → 22: `customer.subscription.*` webhook type assertion updated to `as unknown as` for fields removed from SDK types
  - `@nuxt/test-utils` 3 → 4: no changes required

  **TypeScript / test compatibility fixes (surfaced by upgrades)**

  - `db.values<[string]>()` generic corrected (was `<[string][]>`, which returned the wrong nested type)
  - Non-null assertions added to `allSites[0]` accesses in multi-site middleware (`noUncheckedIndexedAccess`)
  - `H3Event` type assertions updated to use `as unknown as` intermediate where needed
  - `tests/helpers/globals.ts` annotated `@ts-nocheck` for globalThis property augmentation
  - `seedTier` seed helper: removed `slug` field not present in `membershipTiers` schema
  - `pages-access.test.ts`: `settings` values passed as objects, not `JSON.stringify` strings
  - Video token handler checks `response.ok` before calling `response.json()` to avoid TypeError on error bodies

- 4f56e71: feat: scaffold SMS support — phone field on users table, SMS provider credentials registered as encrypted sensitive settings

## 2.0.0-beta.0

### Patch Changes

- 4f1621b: Add social login (Google/GitHub) with account linking, fix OAuth account-insert schema gap, and apply security hardening.

  **Social login & account linking**

  - `auth.config.ts`: fix `accountLinking` config key path (`accountLinking` → `account.accountLinking`) so `trustedProviders` is actually read by Better Auth; add `requireLocalEmailVerified: false` so onboarding-created admins can auto-link without email verification
  - `setup/complete.post.ts`: set `emailVerified: true` for the onboarding admin user (they proved ownership by running the wizard)
  - New `AdminLinkedAccountsManager.vue` component: shows email/password and OAuth provider rows, connect/disconnect buttons, safety guard against removing last auth method
  - `admin/settings/index.vue`: add LinkedAccountsManager to Security tab; deep-link to tab via `?tab=` query param after OAuth callback
  - `login.vue` and `register.vue`: handle `?error=` query params from Better Auth OAuth callbacks with user-friendly messages; add Google/GitHub buttons to register page

  **DB schema fix**

  - `packages/db/src/schema/users.ts`: add `accessTokenExpiresAt`, `refreshTokenExpiresAt`, `scope` columns to the `accounts` table — Better Auth v1.6.14 inserts these on every OAuth account creation; their absence caused `unable_to_link_account` on first Google sign-in
  - Migration `0004_faithful_centennial.sql`: three nullable `ALTER TABLE ADD COLUMN` statements applied automatically on next deploy

  **Security hardening**

  - `theme-resolver.ts`: strip `</style>` tags from KV-stored CSS before SSR injection
  - `site-settings-resolver.ts`: validate primary colour against CSS allowlist regex; restrict font to known-good allowlist before injecting Google Fonts link
  - `03.api-key-auth.ts`: scope API key lookup to `event.context.siteId` so keys from one site cannot authenticate against another
  - `mcp.ts`: add role checks to `create_content` and `update_content` tools (author+ to create, editor+ to publish)
  - `comments.get.ts`: strip `guestEmail` from public comment responses
  - `preview/[token].get.ts`: query by `previewToken` column instead of `id`; add `siteId` scope and expiry check
  - `seed-test-pages.get.ts`: restrict to `NODE_ENV=development` and require super admin auth

  **Docs**

  - `docs/installation.md`: Social Login section with step-by-step Google and GitHub OAuth setup, required secrets, callback URIs, build-time env var reminder
  - `docs/user-guide.md`: Social Login & Account Linking section covering new-user signup, post-onboarding auto-linking, manual linking from Settings, and error message reference

## 1.0.0

### Minor Changes

- Added state-of-the-art passwordless Passkeys (WebAuthn) biometric authentication, fully integrated a secure media-ingesting WordPress WXR Importer with Edge media upload and SSRF protection, added a native edge-compatible Model Context Protocol (MCP) server for AI agent content management, and resolved client-side authentication composable regressions.
