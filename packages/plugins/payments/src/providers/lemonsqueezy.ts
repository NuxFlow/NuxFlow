export interface LsSubscription {
  id: string
  attributes: {
    status: 'active' | 'cancelled' | 'expired' | 'past_due' | 'on_trial' | 'unpaid'
    customer_id: number
    variant_id: number
    renews_at: string | null
    ends_at: string | null
    trial_ends_at: string | null
  }
}

export class LemonSqueezyProvider {
  private apiKey: string
  readonly storeId: string

  constructor(apiKey: string, storeId: string) {
    this.apiKey = apiKey
    this.storeId = storeId
  }

  private async request<T>(path: string, opts: RequestInit = {}): Promise<T> {
    const res = await fetch(`https://api.lemonsqueezy.com/v1${path}`, {
      ...opts,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json',
        ...opts.headers,
      },
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`LemonSqueezy API error ${res.status}: ${body}`)
    }
    return res.json() as Promise<T>
  }

  async createCheckout(opts: { variantId: string; email: string; customData?: Record<string, unknown> }) {
    return this.request<{ data: { attributes: { url: string } } }>('/checkouts', {
      method: 'POST',
      body: JSON.stringify({
        data: {
          type: 'checkouts',
          attributes: {
            checkout_data: { email: opts.email, custom: opts.customData },
          },
          relationships: {
            store: { data: { type: 'stores', id: this.storeId } },
            variant: { data: { type: 'variants', id: opts.variantId } },
          },
        },
      }),
    })
  }

  async getSubscription(subscriptionId: string): Promise<LsSubscription> {
    const res = await this.request<{ data: LsSubscription }>(`/subscriptions/${subscriptionId}`)
    return res.data
  }

  async cancelSubscription(subscriptionId: string): Promise<LsSubscription> {
    const res = await this.request<{ data: LsSubscription }>(`/subscriptions/${subscriptionId}`, {
      method: 'DELETE',
    })
    return res.data
  }

  async verifyWebhook(rawBody: string, signatureHeader: string, secret: string): Promise<boolean> {
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody))
    const expected = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('')
    return expected === signatureHeader
  }
}
