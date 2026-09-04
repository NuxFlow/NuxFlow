# @nuxflow/plugin-canvas

## 2.0.0-beta.8

### Patch Changes

- e79152b: fix: close 8 vulnerabilities found in a full-codebase security sweep

  **Authorization**

  - `PATCH /api/v1/users/:id` no longer lets an `admin` demote or reassign a `super_admin`'s role on that site — the guard already present on the equivalent `DELETE` route was missing here.
  - `POST`/`PATCH /api/v1/content` now require `editor`+ to set `status: 'published'`/`'scheduled'` directly — an `author` (the floor for content-write access) was previously able to self-publish unreviewed content, matching the guard already enforced for the MCP `update_content` tool.

  **Dynamic plugins**

  - The `/_nuxflow/ext/{pluginId}/*` proxy now forwards only an explicit allowlist of headers to plugin Workers (Content-Type, Accept, etc.) instead of the full incoming header set — it previously forwarded `Cookie`/`Authorization` verbatim to third-party plugin code, which only needs a self-signed Ed25519 key to install.
  - The Worker Loader cache key now includes `siteId` — two unrelated tenants installing byte-identical plugin code could previously share the same spawned Worker instance (and whatever in-memory state a prior request left behind).

  **Canvas / stored XSS**

  - Added `safeHref()` (scheme allowlist, matching the existing `javascript:`/`vbscript:`/`data:` guard in `render-tiptap.ts`) and wired it into every link-bearing block prop (Button, Hero, CTA, Footer, Pricing, GDPR banner, Calendar) — these bound straight to `:href` with no scheme validation, unlike the `richtext`/`html` fields which already went through an XSS-filter sanitizer.

  **Payments**

  - New `assertWebhookSiteMatch()` — every Stripe/LemonSqueezy/Paddle webhook must now carry a `siteId`/`site_id` in its signed payload metadata matching the site the request resolved to (via the `Host` header) before any subscription row is written or cancelled. A valid provider signature only proves the payload came from that provider using _some_ site's configured secret, not which tenant it was meant for; two sites sharing a provider account/secret could previously have a webhook meant for one site applied to whichever site the request's Host header resolved to.

  **Theme CSS**

  - `sanitizeThemeCss` now decodes CSS escape sequences (`\75rl(...)` → `url(...)`) before stripping `url()`/`@import`/`expression()` — closes an escape-based bypass of the CSS attribute-selector exfiltration guard.

  **CLI**

  - `nuxflow plugin/theme deploy --site <url>` now refuses a non-`https://` site URL (except localhost/loopback) — it previously sent the admin email/password/session cookie in the clear over whatever scheme was given.

## 2.0.0-beta.7

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

## 2.0.0-beta.6

### Patch Changes

- 5de7709: feat: add an `align` prop to the Text block, mirroring `sanitize-html.ts`'s intentional style-stripping

  `sanitize-html.ts` (added in the theme-system security pass, commit `d04dcbb`) strips `style`/`class` from block-level tags (`p`, `h1`-`h6`, etc.) in rich-text content as an XSS/CSS-injection guard — only `span`/`mark` may keep `style`. That's correct and shouldn't be loosened, but it means content that used inline `style="text-align:center"` on a heading or paragraph (a pattern common before this sanitizer existed) silently lost its alignment the moment the sanitizer started actually running in production, with no supported replacement.

  `CanvasBlockText.vue` now accepts `align?: 'left' | 'center' | 'right'` (default `'left'`), applied as a `text-{align}` class on the block's own wrapper — component-controlled, not sanitized content, so it's unaffected by the whitelist and inherits down to every child element. Exposed as a `select` field in the block's `CanvasBlockDefinition` so it's editable from the admin canvas editor, not just raw content JSON.

  Content that needs per-run visual treatment beyond alignment (e.g. an uppercase/letter-spaced "eyebrow" label) should wrap just that text in `<span style="...">`, which the sanitizer already allows.

## 2.0.0-beta.5

### Minor Changes

- 65d07ae: feat: upgrade @nuxt/ui v3 to v4, add Cloudflare agent skills, consolidate server audit/pagination helpers

  **Nuxt UI v3.3.7 → v4.11.0**

  - `@nuxt/ui` bumped in `apps/nuxflow/package.json` and `packages/canvas/package.json` (dependency, devDependency, and peerDependency)
  - Nuxt UI v4 unifies the former paid `@nuxt/ui-pro` into the single free `@nuxt/ui` package under MIT — confirmed via the package's `LICENSE.md` and `ui.nuxt.com`'s own FAQ, so this closes out the licensing review from the earlier Pro→free migration for good (no separate Pro tier can be reintroduced by accident)
  - The Headless UI → Reka UI / Tailwind Variants rewrite happened in the v2→v3 jump, which this project had already adopted, so v4's actual breaking changes (Pro package rename, `UButtonGroup`→`UFieldGroup`, `UPageMarquee`→`UMarquee`, `UPageAccordion` removal, `.nullify`→`.nullable` modifier, `UForm` nested-form changes) had zero footprint here — verified by a full usage audit before upgrading
  - Verified with lint, typecheck, the full unit (233) and integration (304) suites, and a live `wrangler dev` + Playwright E2E pass covering login, the admin dashboard, content list, and media library

  **Server API cleanup**

  - New `batchWithAudit()` helper in `server/utils/audit.ts` replaces the `db.batch(auditInsert ? [...writes, auditInsert] : writes)` ternary that was duplicated across 44 mutation routes
  - New `countRows()` helper in `packages/db/src/queries/paginate.ts` replaces the repeated `db.select({ total: sql\`count(\*)\` })` one-liner across paginated list routes
  - Fixed `forms/[formIdentifier]/submissions.get.ts`, the one paginated list route that wasn't using the shared `paginate()` helper and so never returned a `total` count

  **E2E test fix**

  - `loginAsAdmin()` test helpers (`auth-flow.spec.ts`, `membership.spec.ts`, `admin-content.spec.ts`) used a loose `getByRole('button', { name: /sign in/i })` locator that ambiguously matched both "Sign in" and "Sign in with Passkey" — fixed to an exact match

  **Cloudflare agent skills**

  - Added `cloudflare`, `wrangler`, `workers-best-practices`, `cloudflare-email-service`, `web-perf`, and `turnstile-spin` to the vendored `.claude/skills`/`.agent/skills` (mirrored, project had zero Cloudflare-specific skill coverage before this)

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

### Minor Changes

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

- 19df24f: fix: icon-class content fields (`i-lucide-*`) never actually rendered a glyph — hero badges, feature/footer icons, carousel/lightbox arrows, accordion chevrons, pricing checkmarks, and the block picker all showed as flat coloured boxes with nothing inside.

  **Root cause:** these components rendered icons as raw `<span :class="iconClass">`, but nothing in this project's build tooling generates CSS for arbitrary `i-lucide-*` utility classes — @nuxt/ui's actual icon mechanism is the `<Icon>`/`<UIcon>` component, which resolves icons at runtime, not via a build-time CSS-class scan. Static template icons happened to render correctly elsewhere in the app only because they go through `<UIcon>`; every place in `packages/canvas` using the raw-span pattern was silently broken regardless of whether the icon name was static or content-driven.

  **Fix:** replaced every raw icon span with `<UIcon mode="svg" :name="...">` (explicit `mode="svg"` — this project's default Nuxt Icon mode is CSS-class based, which has the same build-time-scan limitation) across `CanvasBlockHero`, `CanvasBlockFeatures`, `CanvasBlockFooter`, `CanvasBlockAccordion`, `CanvasBlockCarousel`, `CanvasBlockGallery`, `CanvasBlockPricing`, `NuxLightbox`, `BlockPicker`, `CanvasAdmin`, `AiGenerateModal`, `FieldRenderer`, and `SettingsPanel`. Added `@nuxt/ui` as a peer/dev dependency of `@nuxflow/canvas` so the import resolves correctly for this workspace package.

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
