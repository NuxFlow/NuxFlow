export interface PaddleSubscription {
  id: string
  status: 'active' | 'canceled' | 'past_due' | 'paused' | 'trialing'
  customer_id: string
  items: Array<{ price: { product_id: string; id: string }; quantity: number }>
  current_billing_period: { starts_at: string; ends_at: string } | null
  canceled_at: string | null
}

export class PaddleProvider {
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

  async createTransaction(opts: { priceId: string; customData?: Record<string, unknown> }) {
    return this.request<{ data: { checkout: { url: string } } }>('/transactions', {
      method: 'POST',
      body: JSON.stringify({
        items: [{ price_id: opts.priceId, quantity: 1 }],
        custom_data: opts.customData,
        checkout: { url: null },
      }),
    })
  }

  async getSubscription(subscriptionId: string): Promise<PaddleSubscription> {
    const res = await this.request<{ data: PaddleSubscription }>(`/subscriptions/${subscriptionId}`)
    return res.data
  }

  async cancelSubscription(subscriptionId: string): Promise<PaddleSubscription> {
    const res = await this.request<{ data: PaddleSubscription }>(`/subscriptions/${subscriptionId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ effective_from: 'next_billing_period' }),
    })
    return res.data
  }

  async verifyWebhook(rawBody: string, signatureHeader: string, publicKeyPem: string): Promise<boolean> {
    // Paddle signs webhooks with Ed25519. signatureHeader format: ts=<unix>;h1=<hex>
    const parts = Object.fromEntries(signatureHeader.split(';').map(p => p.split('=')))
    const ts = parts['ts']
    const h1 = parts['h1']
    if (!ts || !h1) return false

    const signedPayload = `${ts}:${rawBody}`
    const pemBody = publicKeyPem.replace(/-----.*-----/g, '').replace(/\s/g, '')
    const keyBytes = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0))

    try {
      const key = await crypto.subtle.importKey(
        'spki',
        keyBytes,
        { name: 'Ed25519' },
        false,
        ['verify'],
      )
      const sigBytes = Uint8Array.from(h1.match(/.{2}/g)!.map((b: string) => parseInt(b, 16)))
      return crypto.subtle.verify('Ed25519', key, sigBytes, new TextEncoder().encode(signedPayload))
    } catch {
      return false
    }
  }
}
