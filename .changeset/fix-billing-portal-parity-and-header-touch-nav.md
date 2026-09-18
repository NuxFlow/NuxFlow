---
"@nuxflow/app": patch
---

fix: LemonSqueezy/Paddle billing-portal parity, touch-safe header dropdown nav, and expanded route test coverage

**Billing portal parity**
- `POST /api/v1/memberships/billing-portal` previously only worked for Stripe — LemonSqueezy and Paddle subscribers had no way to manage billing at all, and the account page's "Manage billing" button was hidden for them outright. Each provider now resolves its own portal correctly: Stripe creates a real billing-portal session; LemonSqueezy has no separate session endpoint, so the route re-fetches the subscription fresh and reads its pre-signed `attributes.urls.customer_portal` link; Paddle creates a portal session via `POST /customers/{id}/portal-sessions` and returns `urls.general.overview`. Free-tier subscriptions (no real provider behind them) now get a clean 404 instead of a broken redirect.

**Header dropdown: real touch/tap support**
- `PublicSiteHeader.vue`'s desktop nav dropdown only worked with a mouse — `@mouseenter`/`@mouseleave` triggered before a click could register (any tap on a touchscreen synthesizes a hover first in some mobile browsers), so tapping the chevron on a nav item with children just closed what the tap itself had opened. The label link and the open/close toggle are now separate elements (a plain link plus a dedicated `aria-expanded`/`aria-haspopup` button), and hover-driven auto-open/close is gated to real mouse pointers via the Pointer Events API (`e.pointerType === 'mouse'`) — touch is driven purely by the unambiguous tap-to-toggle handler. Keyboard users still get focus-out-based closing.

**Test coverage**
- Added integration test coverage for six route groups that previously had none: taxonomies (incl. hierarchical term reparenting on delete), comments (admin moderation + public visibility/guest-email stripping), contact form submission, redirects, forms admin + public submission validation, and the theme system (CRUD, activation, CSS publish, demo import/cleanup). Along the way, `server/api/v1/content/[id]/comments.get.ts` picked up an explicit `requireAuth` import — it was the only route in the codebase relying on Nitro's auto-import for a permission helper instead of importing it directly, which worked in the deployed Worker but silently broke the moderator-visibility branch anywhere the route ran outside the full Nitro build.
