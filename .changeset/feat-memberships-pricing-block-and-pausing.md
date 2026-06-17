---
"@nuxflow/app": patch
---

feat: add customizable membership pricing block and option to pause signups

- **Membership Pricing Block**: Introduced the dynamic `payments/memberships` Canvas block (`MembershipsBlock.vue`) which replaces the hardcoded `pricing.vue` page. It fetches active tiers from the database and supports customizable CTA, titles, and popular tier highlighting.
- **Pause Signups Setting**: Added a configuration setting in Admin Settings to pause new memberships checkouts, with customizable display messages.
- **Checkout Enforcement**: Added validation to the checkout endpoint to block requests with a 403 status when signups are disabled.
- **Paywall error handling**: Implemented toast notifications for paywall checkout errors.
- **Stripe & Webhook Updates**: Added HMAC signature logging in Stripe webhooks and verified webhook parsing. Added `no-console` ESLint overrides for webhook tracing.
- **Documentation**: Updated payments setup guide with Canvas block instructions and Stripe Sandbox troubleshooting.
