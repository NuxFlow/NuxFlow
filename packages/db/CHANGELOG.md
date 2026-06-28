# @nuxflow/db

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
