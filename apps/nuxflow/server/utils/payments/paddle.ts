import type { PaymentProvider } from './types'
import { constantTimeEqualHex, hmacSha256Hex } from '../webhook-crypto'

export interface PaddleSubscription {
  id: string
  status: 'active' | 'canceled' | 'past_due' | 'paused' | 'trialing'
  customer_id: string
  items: Array<{ price: { product_id: string; id: string }; quantity: number }>
  current_billing_period: { starts_at: string; ends_at: string } | null
  canceled_at: string | null
}

// Maximum age (either direction, to allow for clock skew) of a Paddle webhook signature.
export const PADDLE_WEBHOOK_TOLERANCE_SECONDS = 5 * 60

export class PaddleProvider implements PaymentProvider {
  private apiKey: string
  readonly vendorId: string
  private baseUrl: string

  constructor(apiKey: string, vendorId: string, sandbox = false) {
    this.apiKey = apiKey
    this.vendorId = vendorId
    this.baseUrl = sandbox
      ? 'https://sandbox-api.paddle.com'
      : 'https://api.paddle.com'
  }

  private async request<T>(path: string, opts: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...opts,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...opts.headers,
      },
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Paddle API error ${res.status}: ${body}`)
    }
    return res.json() as Promise<T>
  }

  /**
   * Creates a Paddle transaction and returns its hosted checkout URL — the API-driven
   * equivalent of Stripe's `checkout.sessions.create`/LS's `createCheckout`. `customData`
   * is copied by Paddle onto the subscription (and every other entity) it creates from
   * this transaction once paid, which is how the webhook handler recovers `site_id` for
   * tenant-scoping (see `assertWebhookSiteMatch` in `webhook-sync.ts`) — always pass it.
   * `returnUrl`, if given, becomes the transaction's `checkout.url`; Paddle redirects the
   * customer there after a successful payment (appending its own `_ptxn` query param).
   * Omitting it falls back to the seller's account-level default payment link.
   */
  async createTransaction(opts: { priceId: string; customData?: Record<string, unknown>; returnUrl?: string }) {
    return this.request<{ data: { checkout: { url: string } } }>('/transactions', {
      method: 'POST',
      body: JSON.stringify({
        items: [{ price_id: opts.priceId, quantity: 1 }],
        custom_data: opts.customData,
        checkout: { url: opts.returnUrl ?? null },
      }),
    })
  }

  async getSubscription(subscriptionId: string): Promise<PaddleSubscription> {
    const res = await this.request<{ data: PaddleSubscription }>(`/subscriptions/${subscriptionId}`)
    return res.data
  }

  /**
   * Creates a customer portal session — Paddle's equivalent of Stripe's billing portal
   * session / LemonSqueezy's pre-signed `urls.customer_portal`. Unlike Stripe, the session
   * itself carries no return URL (the portal is a standalone hosted page, not a checkout
   * flow step) and always returns a general portal-homepage link regardless of
   * `subscriptionIds`; passing them additionally returns per-subscription deep links
   * (cancel / update payment method), which billing-portal.post.ts doesn't currently
   * surface separately since the general link already gets the customer to the same place.
   */
  async createPortalSession(customerId: string, subscriptionIds?: string[]) {
    return this.request<{ data: { id: string; urls: { general: { overview: string } } } }>(`/customers/${customerId}/portal-sessions`, {
      method: 'POST',
      body: JSON.stringify(subscriptionIds?.length ? { subscription_ids: subscriptionIds } : {}),
    })
  }

  async cancelSubscription(subscriptionId: string): Promise<PaddleSubscription> {
    const res = await this.request<{ data: PaddleSubscription }>(`/subscriptions/${subscriptionId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ effective_from: 'next_billing_period' }),
    })
    return res.data
  }

  /**
   * Paddle signs webhooks with HMAC-SHA256 keyed by the notification destination's own
   * secret key (`pdl_ntfset_...`, found under Developer tools → Notifications → that
   * destination) — a shared secret, NOT an asymmetric Ed25519 keypair. See
   * https://developer.paddle.com/webhooks/signature-verification. `signatureHeader`
   * format: `ts=<unix>;h1=<hex hmac>`; the signed payload is `${ts}:${rawBody}`, mirroring
   * LemonSqueezyProvider.verifyWebhook's construction below.
   */
  async verifyWebhook(rawBody: string, signatureHeader: string, secret: string, nowMs: number = Date.now()): Promise<boolean> {
    const parts = Object.fromEntries(signatureHeader.split(';').map(p => p.split('=')))
    const ts = parts['ts']
    const h1 = parts['h1']
    if (!ts || !h1) return false

    // Replay protection: the timestamp is covered by the HMAC, so a signature older than
    // the tolerance window means a captured-and-resent delivery (e.g. an old
    // `subscription.activated` replayed after cancellation to restore access). Paddle's
    // own SDKs default to the same 5-minute window.
    const tsSeconds = Number(ts)
    if (!Number.isFinite(tsSeconds) || Math.abs(nowMs / 1000 - tsSeconds) > PADDLE_WEBHOOK_TOLERANCE_SECONDS) {
      return false
    }

    const signedPayload = `${ts}:${rawBody}`

    try {
      const expected = await hmacSha256Hex(secret, signedPayload)
      // Constant-time compare — a plain `===` here leaks per-character timing.
      return constantTimeEqualHex(expected, h1)
    } catch {
      // Malformed signature header or a real verification failure both land here —
      // every case must fail closed, not throw a raw 500.
      return false
    }
  }
}
