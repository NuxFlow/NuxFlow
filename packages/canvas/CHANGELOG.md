# @nuxflow/plugin-canvas

## 2.0.0-beta.1

### Minor Changes

- 5e5f1b0: feat: canvas editor improvements — block picker, settings panel, rich text, insert divider, and field renderer enhancements
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

- Updated dependencies [1859470]
  - @nuxflow/plugin-sdk@2.0.0-beta.1

## 2.0.0-beta.0

### Patch Changes

- 0613cf7: refactor: simplify CanvasAdmin settings UI by removing redundant tabs
- bdb5f1e: Implement security enhancements (SSRF protection for backups/imports, Zip bomb/slip validation for restore operations) and edge rate-limiting optimizations using Cloudflare KV/Memory cache. Add new interactive Canvas blocks (Accordion, Button, Pricing) and update Contact Form block dependencies.
  - @nuxflow/plugin-sdk@2.0.0-beta.0

## 1.0.0

### Patch Changes

- 4133bc3: Resolved layout bugs in the Canvas testimonial blockquote by suppressing default browser quotes and optimizing z-index layering. Added a high-contrast dark space glassmorphic features card theme and a responsive 2-column open-source quick-start grid on the homepage.
  - @nuxflow/plugin-sdk@1.0.0
