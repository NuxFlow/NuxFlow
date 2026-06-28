# @nuxflow/plugin-contact-form

## 2.0.0-beta.1

### Patch Changes

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
- Updated dependencies [560d4eb]
- Updated dependencies [5e5f1b0]
- Updated dependencies [9ad2445]
- Updated dependencies [058ca48]
- Updated dependencies [b8b1b2c]
  - @nuxflow/plugin-canvas@2.0.0-beta.1
  - @nuxflow/plugin-sdk@2.0.0-beta.1

## 2.0.0-beta.0

### Patch Changes

- bdb5f1e: Implement security enhancements (SSRF protection for backups/imports, Zip bomb/slip validation for restore operations) and edge rate-limiting optimizations using Cloudflare KV/Memory cache. Add new interactive Canvas blocks (Accordion, Button, Pricing) and update Contact Form block dependencies.
- Updated dependencies [0613cf7]
- Updated dependencies [bdb5f1e]
  - @nuxflow/plugin-canvas@2.0.0-beta.0
  - @nuxflow/plugin-sdk@2.0.0-beta.0

## 1.0.0

### Patch Changes

- @nuxflow/plugin-sdk@1.0.0
