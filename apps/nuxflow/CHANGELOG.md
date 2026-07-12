# @nuxflow/app

## 2.0.0-beta.4

### Patch Changes

- 923e369: fix: stop fragmenting the Better Auth instance cache by port on production domains

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

- a60be5d: fix: production login succeeding then immediately bouncing back to /login

  Sign-in worked and correctly set a secure session cookie, but the very next page's
  server-side session check (`@onmax/nuxt-better-auth`'s internal SSR self-fetch, which
  runs on every page load) would silently invalidate it and redirect back to /login —
  even on a hard refresh, since the failure happened server-side during SSR, not in the
  browser.

  Root cause: Nitro dispatches this kind of internal self-fetch without forwarding the
  real `Host` header, defaulting to `localhost` — even inside a fully deployed production
  Worker. `buildBetterAuthInstance()` was branching `baseURL`/cookie-protocol on the
  current request's Host header, treating `localhost` as "we're in local dev" and
  switching to a plain string `baseURL` that dropped the `protocol: 'https'` pinning.
  That flipped Better Auth into non-secure-cookie mode for that one internal check, which
  made it look for the session under the wrong cookie name, fail to find it, and clear
  every session cookie — sabotaging the request that had just legitimately signed in.

  Whether this is a local dev deployment is now determined once from the deployment's own
  `sites` table (a local install's site domain is always `localhost`, which production
  never is) instead of from any single request's Host header, so real requests and
  internal self-fetches always resolve identically. Passkey origin/rpID still uses the
  per-request Host for local-dev WebAuthn correctness, since passkey ceremonies only ever
  originate from a genuine browser request, never Nitro's internal self-fetches — so that
  part isn't exposed to the same inconsistency.

## 2.0.0-beta.3

### Minor Changes

- 0fc8497: feat: per-site social login credentials, unified Better Auth session validation, and local-dev passkey fix

  **Per-site Google/GitHub OAuth credentials**
  - `server/utils/better-auth.ts` now resolves `auth.google_client_id`/`auth.google_client_secret`/`auth.github_client_id`/`auth.github_client_secret` via `resolveSetting()` (per-site DB override first, deployment-wide env var fallback second) instead of reading env vars directly — the same pattern already used for media/email/AI/payments credentials
  - The Better Auth instance cache is now keyed per `Host` header (previously a single shared slot) so different sites sharing a Worker isolate never see each other's OAuth credentials, and a credential change on one site doesn't invalidate every other site's cache
  - New "Social Login" card in Admin → Settings → Integrations for entering per-site Google/GitHub client ID and secret, with redirect-URI hints computed from the site's own domain
  - `server/api/v1/settings/index.get.ts`/`index.patch.ts` extended to read/write the four new setting keys; secrets are masked on read and AES-GCM encrypted at rest via the existing `SENSITIVE_SETTING_KEYS` mechanism

  **Auth session validation unification**
  - All remaining `getUserSession`/`requireUserSession`/`serverAuth` call sites (the `@onmax/nuxt-better-auth`-provided helpers, which resolve a second, type-scaffolding-only Better Auth instance) migrated to `getAuthSession`/`requireSession` from `server/utils/auth.ts`, which are backed by the one real instance that actually serves `/api/auth/**`. Closes the last gap from the earlier session-validation-drift fix.
  - Removed now-confirmed-dead code from `server/auth.config.ts` (`sendResetPassword`, `account.accountLinking`, real `socialProviders` values) — that instance never receives real auth traffic, so this logic was unreachable; only the `socialProviders` provider _keys_ are kept, since the client's `signIn.social()` provider-name type is inferred from them

  **Local-dev passkey origin fix**
  - Passkey (WebAuthn) registration and login were silently broken in local `wrangler dev` since the dev server stopped running through `nuxt dev` on port 3000: the code's `isDev` branch relied on `NODE_ENV !== 'production'`, but `wrangler dev` always builds with `NODE_ENV=production`, and the fallback `config.public.siteUrl` resolves to workerd's own loopback bind address rather than the browser's actual origin — either one causes the browser to reject the WebAuthn ceremony with a SecurityError before any request is sent. The RP origin/rpID (and dev-mode `baseURL`) are now derived from the incoming request's own `Host` header instead.
  - The per-host auth-instance cache key now uses the full `Host` header (not just the hostname) so an occasional port-less request doesn't get cached and served to later, correctly-ported requests for the rest of the 5-minute TTL.

  **Misc**
  - Page `<title>` order swapped to `{site name} | {page title}` (was `{page title} | {site name}`)
  - `docs/multi-site.md` and `docs/installation.md` updated for per-site social login setup

## 2.0.0-beta.2

### Minor Changes

- 19df24f: fix: eliminate the dual Better Auth instance that caused site-wide 401s ("Authentication required") on every protected route while `/api/auth/**` itself kept working

  **Root cause:** the app has always had two separately-configured Better Auth instances — `server/utils/better-auth.ts` (hand-built, actually handles every `/api/auth/**` request and rate-limiting) and `server/auth.config.ts` (via `@onmax/nuxt-better-auth`, used only by that module's own `requireUserSession`, which every `requireAuth`/`requireRole` check went through). Each instance independently derives its own `baseURL`/protocol/cookie-naming from the request, so a session issued by one only validates correctly if the other happens to agree — which they silently stopped doing after an unrelated edit to the origin-detection logic in both files, breaking `notifications`, `settings`, `themes`, and every other protected endpoint in production while `get-session` kept returning 200.

  **Fix:** added `requireSession(event)` in `server/utils/auth.ts`, backed directly by `getOrCreateBetterAuth()` — the same instance that already handles `/api/auth/**` — so there is exactly one source of truth for session validation. Repointed `requireAuth`/`requireSuperAdmin` (`permissions.ts`) and 5 direct call sites (account/subscription, memberships checkout/billing-portal, users/me) from the module's `requireUserSession` to this helper. `server/auth.config.ts` is kept only because `@onmax/nuxt-better-auth` needs it to bootstrap client-side composables (`useUserSession()` etc.); nothing server-side reads session state from it anymore, so this class of drift is no longer possible. Widened `getOrCreateBetterAuth`'s cached-instance type (it was narrowed to `{ handler }` only) so `.api.getSession()` typechecks. Added a matching `globalThis.requireSession` stub to the integration-test harness.

  Also includes, from the same working session:
  - `server/utils/pw.ts`: the Argon2 service-binding hasher now catches hash/verify failures and falls back to scrypt with a warning, instead of the failure propagating unhandled.
  - `server/api/v1/setup/complete.post.ts`: the initial-setup path can now re-run against a domain that already has a site record (clearing previously-seeded content/settings/roles first) when the site or user table is empty, supporting a clean re-setup after a D1 wipe without deleting the database by hand.
  - `docs/multi-site.md`, `CLAUDE.md`: documented the one-time setup-token link flow for adding secondary sites (introduced 2026-06-02) — previously undocumented, which was the direct cause of a support question this session. The docs now cover copying the full `?token=...` URL, why the bare domain 403s, and that a failed attempt doesn't burn the token.

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

### Patch Changes

- Updated dependencies [19df24f]
- Updated dependencies [e4d1b14]
  - @nuxflow/canvas@2.0.0-beta.2
  - @nuxflow/db@2.0.0-beta.2

## 2.0.0-beta.1

### Minor Changes

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

- a06cd27: feat: Atom feed (/atom.xml), llms.txt route, and RSS enhancements (author, OG image, media namespace)
- 560d4eb: Add blog index, full-text search, share buttons, content excerpt/OG image, and fix CLI install on fresh clone.

  **Blog & public routes**
  - `app/pages/blog/index.vue`: paginated blog post index at `/blog`; fetches `GET /api/public/posts` with `?page` and `?limit` support.
  - `server/api/public/posts.get.ts`: new endpoint returning published posts scoped to the current site, with author, excerpt, and featured image.
  - `app/pages/search.vue`: full-text search page at `/search`; uses the existing `GET /api/v1/search` endpoint (no auth required); highlights matched terms.
  - `server/api/v1/search.get.ts`: FTS5 results now include `slug`, `title`, and `type` so the search page can link directly to content.
  - `app/components/PublicShareButtons.vue`: new share buttons component (Web Share API with Twitter/LinkedIn/copy-link fallbacks); rendered on prose content pages and taxonomy archives.
  - RSS feed (`server/routes/feed.xml.ts`): include `<content:encoded>` full HTML body and `<author>` per item.
  - Sitemap and robots.txt: include blog and taxonomy archive URLs; robots now respects the site's `seoNoindex` setting.

  **Content editor**
  - Excerpt and OG image fields added to the admin content editor sidebar (`app/pages/admin/content/[id].vue`); excerpt is used in blog listings, RSS, and OG meta; OG image can be picked from the media library.
  - `server/api/v1/content/[id].patch.ts`: accept `excerpt` and `ogImage` in the PATCH body.
  - `server/api/public/pages/[slug].get.ts`: return `author`, `excerpt`, and `ogImage` in the public page response.
  - `app/pages/[...slug].vue` and `app/pages/[taxonomySlug]/[termSlug].vue`: render author byline, featured image, and share buttons; pass `ogImage` to `useSeoMeta`.

  **Scheduled tasks**
  - `server/tasks/publish-scheduled.ts`: Nitro task wrapper for the scheduled-publish logic (required for the Nitro task system to discover and run it on schedule).

  **CLI**
  - `packages/cli/build.mjs`: new esbuild script producing a CJS bundle at `bin/nuxflow.cjs` (CJS required because `fs-extra` uses dynamic `require()` internally).
  - `bin/nuxflow.cjs` is now committed to git so `pnpm install` can create the `node_modules/.bin/nuxflow` symlink immediately — previously the symlink failed because the built file didn't exist until the `prepare` lifecycle ran (too late in pnpm's install sequence).
  - Added `prepare` script so the CLI rebuilds itself automatically on `pnpm install` (keeps `bin/nuxflow.cjs` fresh after source changes).
  - Added `files` field (`bin/`, `build.mjs`) so the compiled binary is included when the package is published to npm.
  - Scaffold template (`src/utils/scaffold.ts`): `client.ts` template now documents `definition`, `ref`, `onMounted`, full inline types for `Registry`, `VueLike`, and `BlockDefinition`, and the `BLOCK_DEFINITION` pattern for Canvas editor sidebar fields.

  **Canvas plugin**
  - `CanvasBlockHero`: responsive layout and mobile padding fixes.
  - `CanvasBlockFeatures`: icon rendering and grid alignment improvements.

- 6dc7bfa: Add Cloudflare Stream and Images credentials to the admin settings UI.

  Previously, `NUXT_CLOUDFLARE_ACCOUNT_ID` and `NUXT_CLOUDFLARE_STREAM_TOKEN` had to be set as environment variables or wrangler vars before video uploads would work — there was no UI and the failure was silent (the frontend never showed an error toast because the request never began).

  - New **Settings → Media** tab with Cloudflare Stream and Cloudflare Images sections, including setup instructions and a link to where each credential is found in the Cloudflare dashboard
  - Stream token and Images token are stored encrypted at rest (AES-GCM, same as AI API keys)
  - All Cloudflare credentials (account ID, stream token, images token, delivery URL) now read from DB settings first with env var fallback — no wrangler redeploy required when credentials change
  - Refactored `getActiveProvider()` to accept an H3 event and resolve credentials via `resolveSetting()` across all 8 call sites (upload, media delete, themes, restore, WordPress import, AI image generation, site deletion)
  - Error message on unconfigured Stream now points to Settings → Media instead of a generic note

- 6c9590c: Add editorial calendar and scaffold event fields for future events system.

  - New `/admin/calendar` page with month-view grid, colour-coded content chips by status (published/scheduled/draft/review/archived), month navigation, and click-through to the content editor
  - New `GET /api/v1/content/calendar` endpoint accepting `from`/`to` date params; returns content items grouped by their publication or scheduled date
  - Calendar link added to admin sidebar between Content and Taxonomies
  - `content_items` table gains five nullable event scaffold columns (`event_start_at`, `event_end_at`, `event_location`, `event_url`, `event_all_day`) and an index on `(site_id, event_start_at)` for efficient date-range queries (migration 0006)
  - Events System section added to roadmap documenting the full planned feature and what groundwork is already in place

- 9ad2445: feat: gallery block with lightbox, EXIF extraction, image sitemap, and SEO/GEO improvements

  **Canvas — Gallery block & lightbox**
  - New `CanvasBlockGallery` block: responsive photo grid with configurable columns (2/3/4), gap, rounded corners, and optional lightbox
  - New `NuxLightbox` component: keyboard-navigable (←/→/Esc) and touch-enabled modal image viewer shared by both gallery and single image blocks
  - `CanvasBlockImage` gains a "Open lightbox on click" toggle field

  **Media**
  - EXIF extraction on JPEG/TIFF upload via new zero-dependency `server/utils/exif.ts` (reads IFD0 + ExifIFD from JPEG APP1 segments, stored in `media.metadata.exif`)
  - Image sitemap at `/sitemap-images.xml` for Google Image Search indexing

  **Blog**
  - Grid/list layout toggle on the blog index page with localStorage persistence

  **SEO & GEO**
  - Theme demo import now includes site settings (SEO, appearance, etc.) — `settings` was missing from the `what` array in both the server schema and the frontend call
  - AI Crawlers tab in Admin → SEO shows a persistent warning to check Cloudflare's "Block AI Scrapers and Crawlers" toggle, which overrides `robots.txt` at the network level

  **Performance & reliability**
  - Migration middleware gains a fast-path boolean flag (`_migrationsDone`) so already-migrated isolates skip all async overhead on subsequent requests
  - Scheduled task registration moved to unconditional lists; demo tasks guard themselves at runtime via `isDemo` config rather than at build time via `process.env`

- 1474878: feat: nightly prune task — automatically deletes audit logs beyond retention window and trims content revisions to configurable per-item limit
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

- 1958b5e: feat: add customizable membership pricing block and option to pause signups

  - **Membership Pricing Block**: Introduced the dynamic `payments/memberships` Canvas block (`MembershipsBlock.vue`) which replaces the hardcoded `pricing.vue` page. It fetches active tiers from the database and supports customizable CTA, titles, and popular tier highlighting.
  - **Pause Signups Setting**: Added a configuration setting in Admin Settings to pause new memberships checkouts, with customizable display messages.
  - **Checkout Enforcement**: Added validation to the checkout endpoint to block requests with a 403 status when signups are disabled.
  - **Paywall error handling**: Implemented toast notifications for paywall checkout errors.
  - **Stripe & Webhook Updates**: Added HMAC signature logging in Stripe webhooks and verified webhook parsing. Added `no-console` ESLint overrides for webhook tracing.
  - **Documentation**: Updated payments setup guide with Canvas block instructions and Stripe Sandbox troubleshooting.

- 4f56e71: feat: scaffold SMS support — phone field on users table, SMS provider credentials registered as encrypted sensitive settings
- 9bbf35c: feat: show unconfigured banner and disable upload button on video page when Cloudflare Stream credentials are missing
- 7c28645: Fix Linux build OOM crash by setting NODE_OPTIONS heap limit via cross-env

  Nitro's cloudflare-module bundle step exhausts the default V8 heap (~2 GB) on Linux. Added `cross-env NODE_OPTIONS=--max-old-space-size=4096` to the build script so both Linux and Windows deployments use a 4 GB heap cap without requiring a manually set environment variable.

  Also adds a Linux permission error note to the installation quickstart docs.

- 9f7fbbd: Fix `state_mismatch` error on social login for secondary custom domains.

  **Root cause:** The Better Auth instance was created once at module load time with a hardcoded `baseURL` from `NUXT_PUBLIC_SITE_URL`. OAuth callbacks on secondary domains (e.g. `customerdomain.com`) had their `redirect_uri` set to the primary domain, causing Google/GitHub to reject the state token.

  **Auth fixes**
  - `server/utils/better-auth.ts`: new shared utility that builds a Better Auth instance per isolate with a 5-minute TTL. In production it loads all site domains from the DB and passes `{ allowedHosts, protocol: 'https', fallback }` as `baseURL` so Better Auth resolves the correct `redirect_uri` from the incoming `Host` header on every OAuth request.
  - `server/middleware/04.auth-override.ts`: new middleware that intercepts all `/api/auth/**` requests before any route handler runs, guaranteeing our instance (not the module's hardcoded one) handles every auth request.
  - `server/api/auth/[...all].ts`: updated to delegate to the shared utility.
  - `app/auth.config.ts`: fixed client-side `baseURL` resolution — `window.location.origin` is now checked first on the browser so the auth client on a secondary domain sends requests to that domain rather than the baked-in `NUXT_PUBLIC_SITE_URL`.

  **Docs**
  - `docs/installation.md`: clarify that `NUXT_PUBLIC_SITE_URL` is a `[vars]` entry in `wrangler.toml`, not a `wrangler secret put` secret; add multi-domain note to Google OAuth callback URI setup.
  - `docs/multi-site.md`: new "Social login on custom domains" section explaining per-domain callback URI registration for Google and the limitation of GitHub OAuth (single callback URL per app).

- Updated dependencies [1859470]
- Updated dependencies [560d4eb]
- Updated dependencies [5e5f1b0]
- Updated dependencies [6c9590c]
- Updated dependencies [9ad2445]
- Updated dependencies [bd1d5bd]
- Updated dependencies [fe571be]
- Updated dependencies [4f56e71]
- Updated dependencies [058ca48]
- Updated dependencies [b8b1b2c]
  - @nuxflow/plugin-canvas@2.0.0-beta.1
  - @nuxflow/plugin-sdk@2.0.0-beta.1
  - @nuxflow/db@2.0.0-beta.1

## 2.0.0-beta.0

### Minor Changes

- 428031e: feat: add AI content generation and translation suite
  - Integrated OpenAI, Anthropic, and DeepSeek AI providers.
  - Added AI content tools for grammar correction, translation, SEO suggestions, and bulk alt-text generation.
  - Added AI generation modals in the Canvas Editor.
  - Updated settings UI for configuring AI provider API keys.
  - Handled UI updates for media library alt text generation.

- 4698a81: Add membership, auth, and public-facing pages; introduce 3-layer test suite; fix Cloudflare 522 registration timeout.

  **New pages:** `/register`, `/forgot-password`, `/reset-password`, `/pricing`, `/account` — all using the `auth` layout with glass-card styling.

  **Registration fix:** The `POST /api/public/auth/register` handler previously made a self-referencing HTTP call to Better Auth's sign-up endpoint, which causes a Cloudflare 522 connection-timeout when a Worker tries to fetch itself. The handler now creates the user and credential account directly in the database using `hashPassword` from `better-auth/crypto`, matching the setup wizard's approach. A new `GET /api/public/auth/registration-status` endpoint lets the register page check whether public registration is enabled before showing the form, so users are not presented with a form they cannot submit.

  **Content gating:** `GET /api/public/pages/[slug]` now enforces visibility rules (`public`, `members`, `private`, `tier:<id>`) and returns structured 402 payloads with available tier data.

  **Test suite:** Added a 3-layer test infrastructure — 10 unit test files (Vitest, pure logic), 5 integration test files (real in-memory SQLite via libSQL), and 3 Playwright E2E specs with a global setup that seeds a test site. New scripts: `test:integration`, `test:all`, `test:e2e`.

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

### Patch Changes

- a03f004: fix: resolve pnpm hoisting issues for ESLint and Better Auth
  - Set `shamefully-hoist=true` in `.npmrc` to guarantee strict module resolution for Nuxt ESLint config.
  - Pinned `kysely` to `0.28.5` via `pnpm.overrides` in `package.json` to prevent `@better-auth` from crashing during the Cloudflare Nitro build process when `kysely` v0.29 is improperly hoisted.

- dc90543: Fix SSR relative fetch host context issue inside the setup guard route middleware to ensure onboarding setup is loaded successfully on secondary site custom domains. Clean up explicit any type-casts in super admin sites dashboard forms.
- bdb5f1e: Implement security enhancements (SSRF protection for backups/imports, Zip bomb/slip validation for restore operations) and edge rate-limiting optimizations using Cloudflare KV/Memory cache. Add new interactive Canvas blocks (Accordion, Button, Pricing) and update Contact Form block dependencies.
- Updated dependencies [0613cf7]
- Updated dependencies [4f1621b]
- Updated dependencies [bdb5f1e]
  - @nuxflow/plugin-canvas@2.0.0-beta.0
  - @nuxflow/db@2.0.0-beta.0
  - @nuxflow/plugin-contact-form@2.0.0-beta.0
  - @nuxflow/plugin-html-block@2.0.0-beta.0
  - @nuxflow/plugin-sdk@2.0.0-beta.0
  - @nuxflow/plugin-payments@2.0.0-beta.0

## 1.0.0

### Minor Changes

- Added state-of-the-art passwordless Passkeys (WebAuthn) biometric authentication, fully integrated a secure media-ingesting WordPress WXR Importer with Edge media upload and SSRF protection, added a native edge-compatible Model Context Protocol (MCP) server for AI agent content management, and resolved client-side authentication composable regressions.

### Patch Changes

- 4133bc3: Resolved Nitro router sibling dynamic conflicts by restructuring dynamic form endpoints under a unified `[formIdentifier]` directory. Fixed import page visibility contrast issues in light mode, integrated global `<UNotifications />` in app.vue, and added a fully comprehensive administrative E2E playwright test suite.
- 4133bc3: Resolved layout bugs in the Canvas testimonial blockquote by suppressing default browser quotes and optimizing z-index layering. Added a high-contrast dark space glassmorphic features card theme and a responsive 2-column open-source quick-start grid on the homepage.
- 4133bc3: Added site settings resolver server plugin to automatically resolve and cache site configuration at boot, updated settings and themes administrative panels, and refined styling assets for responsive alignment.
- Updated dependencies [4133bc3]
- Updated dependencies
  - @nuxflow/plugin-canvas@1.0.0
  - @nuxflow/db@1.0.0
  - @nuxflow/plugin-html-block@1.0.0
  - @nuxflow/plugin-sdk@1.0.0
  - @nuxflow/plugin-payments@1.0.0
  - @nuxflow/plugin-contact-form@1.0.0
