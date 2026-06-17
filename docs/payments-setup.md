# Payments & Memberships Setup

NuxFlow has built-in support for subscription memberships and content gating. It connects to your choice of payment provider — Stripe, Lemon Squeezy, or Paddle — all configured through the admin dashboard with no code changes required.

---

## Overview

| Feature | Details |
|---|---|
| Providers | Stripe, Lemon Squeezy, Paddle (one or more simultaneously) |
| Billing intervals | Monthly, yearly, one-time |
| Free tiers | Supported — no provider required |
| Content gating | Per-page: public / members-only / specific tier |
| Auto-sync | Stripe: Tier creation/update automatically creates products and prices. Lemon Squeezy/Paddle: Requires manual variant/product mapping |
| Webhooks | All three providers supported; subscriptions updated in real time |
| Member portal | Stripe: Customer Portal link; LS/Paddle: cancel from `/account` |

---

## Step 1 — Create membership tiers

Go to **Admin → Memberships → Tiers** and click **New tier**.

Fill in:

- **Name** — displayed on the paywall and in the subscriber table
- **Price** — set to `0` for a free tier (no provider needed)
- **Currency** — ISO 4217 code, e.g. `USD`, `EUR`, `GBP`
- **Interval** — `Monthly`, `Yearly`, or `One-time`
- **Features** — bullet points shown to visitors on the paywall

If Stripe is configured when you save, NuxFlow automatically creates the matching product and price. The tier card will show a **Synced** badge when this succeeds.

**Important for Lemon Squeezy & Paddle:** These providers do not support auto-sync. You must manually create the Product/Variant in their respective dashboards first, then edit your Tier in NuxFlow and paste the **Lemon Squeezy Variant ID** or **Paddle Product ID** into the tier's settings.

---

## Step 2 — Configure a payment provider

Go to **Admin → Settings → Payments** and fill in the credentials for at least one provider.

### Stripe

| Setting | Where to find it |
|---|---|
| **Secret key** | [Stripe Dashboard → Developers → API keys](https://dashboard.stripe.com/apikeys) — use the `sk_live_...` key in production, `sk_test_...` for testing |
| **Webhook secret** | Created in the next step |

#### Set up the Stripe webhook

1. In the Stripe Dashboard go to **Developers → Webhooks → Add endpoint**.
2. Set the endpoint URL to:
   ```
   https://yourdomain.com/api/v1/memberships/webhooks/stripe
   ```
3. Select these events:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. After saving, copy the **Signing secret** (`whsec_...`) and paste it into **Settings → Payments → Stripe Webhook Secret**.

> [!WARNING]
> **Stripe Sandboxes (2025+ UI):** If you are testing with a Stripe Sandbox, ensure that your NuxFlow `sk_test_...` Secret Key and your Webhook Destination are created in the **exact same Sandbox**. An API key from the default test mode will not trigger webhooks in a newly created Sandbox.

NuxFlow verifies the HMAC signature on every webhook. Requests with an invalid or missing signature are rejected with HTTP 400.

---

### Lemon Squeezy

| Setting | Where to find it |
|---|---|
| **API key** | [Lemon Squeezy → Settings → API](https://app.lemonsqueezy.com/settings/api) |
| **Store ID** | The numeric ID shown in the URL when you view your store |
| **Webhook secret** | Created in the next step |

#### Set up the Lemon Squeezy webhook

1. In Lemon Squeezy go to **Settings → Webhooks → Add webhook**.
2. Set the URL to:
   ```
   https://yourdomain.com/api/v1/memberships/webhooks/lemonsqueezy
   ```
3. Set a **Signing secret** (generate a random string — at least 32 characters).
4. Enable these events:
   - `subscription_created`
   - `subscription_updated`
   - `subscription_resumed`
   - `subscription_cancelled`
   - `subscription_expired`
5. Paste the signing secret into **Settings → Payments → Lemon Squeezy Webhook Secret**.

NuxFlow verifies the HMAC-SHA256 `X-Signature` header on every request.

---

### Paddle

| Setting | Where to find it |
|---|---|
| **API key** | [Paddle Dashboard → Developer tools → Authentication](https://vendors.paddle.com/api-keys) |
| **Vendor ID** | Your numeric Paddle vendor ID, shown in **Developer tools → Authentication** |
| **Webhook public key** | Created in the next step |

#### Set up the Paddle webhook

1. In the Paddle Dashboard go to **Developer tools → Notifications → New destination**.
2. Set the URL to:
   ```
   https://yourdomain.com/api/v1/memberships/webhooks/paddle
   ```
3. Enable these events:
   - `subscription.created`
   - `subscription.updated`
   - `subscription.activated`
   - `subscription.canceled`
4. After saving, copy the **Public key (PEM format)** from the notification endpoint details and paste it into **Settings → Payments → Paddle Webhook Public Key**.

NuxFlow verifies the Ed25519 signature in the `Paddle-Signature` header.

---

## Step 3 — Add a pricing page (canvas block)

There is no hardcoded `/pricing` route in NuxFlow. Instead, you embed your live membership tiers anywhere on your site using the **Membership Pricing** canvas block.

1. In the admin go to **Content → New page** and set the slug to `/pricing` (or any path you prefer).
2. Switch the editor to **Canvas editor** and add the **Membership Pricing** block from the block picker (under the **Plugin** category).
3. In the block settings panel you can configure:

| Setting | Description |
|---|---|
| **Section title** | Heading displayed above the tier cards |
| **Subtitle** | Supporting text below the heading |
| **Button label** | CTA text on each tier card (default: "Get started") |
| **Highlight tier name** | Exact name of one tier to visually promote as "Popular" |
| **Show "Already a member?" link** | Toggle the account management link at the bottom |
| **Background / text colour** | Section-level colour overrides |
| **Padding** | Vertical and horizontal spacing around the block |

The block fetches your active tiers live from the database — there is no content to manually enter. Add, rename, or archive a tier in **Admin → Memberships → Tiers** and the pricing page reflects the change immediately.

Because it is a canvas page you can place the block anywhere: between a hero and a FAQ accordion, inside a two-column layout, or on multiple pages simultaneously.

---

## Step 4 — Gate content

In the content editor, open the **SEO & Access** panel (right sidebar) and set **Access** to one of:

| Value | Who can view |
|---|---|
| **Public** (default) | Everyone |
| **Members** | Any subscriber with an active subscription |
| **[Tier name]** | Only subscribers on that specific tier |

Visitors without access see a paywall with your available tiers and a subscribe button.

---

## Step 5 — Test the flow

Use your provider's test mode to verify end-to-end:

**Stripe test flow:**
1. Use a Stripe test API key (`sk_test_...`) and the test webhook secret.
2. Create a tier — it auto-syncs to Stripe in test mode.
3. Click **Subscribe** on the paywall while logged in.
4. Complete the Stripe Checkout using card number `4242 4242 4242 4242`.
5. Stripe fires `checkout.session.completed` → NuxFlow activates the subscription.
6. Reload the gated page — it should now be accessible.

**Lemon Squeezy test flow:**
1. Use a [Lemon Squeezy test store](https://docs.lemonsqueezy.com/help/getting-started/test-mode) (available automatically without identity verification).
2. Create a Product and Variant manually in the Lemon Squeezy dashboard.
3. Edit your Tier in NuxFlow and paste the **Lemon Squeezy Variant ID** (e.g. `12345`).
4. Complete the LS checkout with a test card (e.g. `4242 4242 4242 4242`).
5. LS fires `subscription_created` → NuxFlow activates the subscription.

---

## Subscription management

### Members

Members can view and manage their subscription from `/account`:

- **Active subscription**: plan name, renewal date, included features.
- **Manage billing** (Stripe only): opens the Stripe Customer Portal for invoice history and payment method updates.
- **Cancel subscription**: available for all providers. Cancellation takes effect immediately and the webhook confirms the change in the background.

### Admins

**Admin → Memberships → Subscribers** shows a live table of all subscriptions with their provider, status, tier, and renewal date.

---

## Frequently asked questions

**Can I use multiple providers at once?**
Yes. Configure all three if you want to give customers a choice. At checkout, NuxFlow uses the first configured provider in order: Stripe → Lemon Squeezy → Paddle.

**What happens when I change a tier's price?**
NuxFlow creates a new product/price in the provider (matching Stripe's own behaviour). Existing subscribers remain on the old price until they cancel and re-subscribe. The **Subscribers** tab shows which tier each subscriber is on.

**Can I offer a free tier alongside paid ones?**
Yes. Free tiers (price = 0) skip the payment provider entirely and activate immediately on click. Members on a free tier can still access gated content.

**What if a webhook fails?**
NuxFlow returns HTTP 200 on success or 400/503 on permanent errors. Providers retry on network-level failures. If a subscription state gets out of sync, you can manually check the subscription in your provider dashboard — the status will reconcile on the next webhook delivery.

**Do I need a paid Cloudflare Workers plan for payments?**
No. Payments are a core NuxFlow feature and work on both the free and paid Workers plans. The Workers Paid plan is only required for *dynamic plugins*.
