---
"@nuxflow/app": minor
"@nuxflow/db": minor
"@nuxflow/canvas": minor
---

Add Cloudflare Stream video support, membership tier management, canvas block improvements, and wrangler dev build automation.

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
