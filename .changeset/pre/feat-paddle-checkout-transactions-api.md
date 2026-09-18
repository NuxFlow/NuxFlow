---
"@nuxflow/app": minor
---

feat: complete the Paddle checkout flow via the Transactions API

`POST /api/v1/memberships/checkout` never actually worked for Paddle — it built a URL to
`/checkout?product=...&user_id=...&site_id=...`, a page that didn't exist anywhere in the
app, so a Paddle subscribe click had nowhere to go. `PaddleProvider` already had a working
`createTransaction()` method wired up to Paddle's real Transactions API; it just wasn't
being called.

The checkout route now calls `paddle.createTransaction()` and redirects to the hosted
checkout URL Paddle returns — the same pattern already used for Stripe's checkout session
and Lemon Squeezy's checkout, so `Paywall.vue`/`MembershipsBlock.vue` needed no changes at
all (they already just do `window.location.href = url`).

- `createTransaction()` now accepts a `returnUrl`, passed as the transaction's
  `checkout.url` so Paddle redirects back after a successful payment.
- `customData` now includes `site_id` alongside `user_id`/`tier_id` — Paddle copies
  `custom_data` onto the subscription it creates, which the webhook handler's
  `assertWebhookSiteMatch()` (see the security-sweep changeset) now requires.
- Corrected stale comments/docs in `payments/types.ts` and `CLAUDE.md` claiming Paddle
  checkout "is not API-driven" — it now is, same as Stripe and Lemon Squeezy.
- Added a Paddle test flow to `docs/payments-setup.md`, matching the existing Stripe/LS
  sections.
