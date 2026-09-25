import Stripe from 'stripe'
import type { PaymentProvider } from './types'

// https://docs.stripe.com/currencies#zero-decimal and #three-decimal
const ZERO_DECIMAL = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF'])
const THREE_DECIMAL = new Set(['BHD', 'JOD', 'KWD', 'OMR', 'TND'])

/**
 * Tier prices are stored in major units (e.g. 9.99). Stripe wants the smallest currency
 * unit, which is not always cents: ¥1000 is unit_amount 1000, not 100000, and three-decimal
 * currencies use thousandths with the last digit 0.
 */
export function toStripeUnitAmount(amount: number, currency: string): number {
  const code = currency.toUpperCase()
  if (ZERO_DECIMAL.has(code)) return Math.round(amount)
  if (THREE_DECIMAL.has(code)) return Math.round(amount * 100) * 10
  return Math.round(amount * 100)
}

export class StripeProvider implements PaymentProvider {
  private client: Stripe

  constructor(secretKey: string) {
    this.client = new Stripe(secretKey)
  }

  async createCustomer(email: string, name: string) {
    return this.client.customers.create({ email, name })
  }

  async listCustomersByEmail(email: string) {
    const result = await this.client.customers.list({ email, limit: 1 })
    return result.data
  }

  async createProduct(name: string, description?: string) {
    return this.client.products.create({
      name,
      description: description || undefined,
    })
  }

  async updateProduct(productId: string, name: string, description?: string) {
    return this.client.products.update(productId, {
      name,
      description: description || undefined,
    })
  }

  async createPrice(productId: string, unitAmount: number, currency: string, interval: 'month' | 'year' | 'one_time') {
    const isRecurring = interval !== 'one_time'
    return this.client.prices.create({
      product: productId,
      unit_amount: toStripeUnitAmount(unitAmount, currency),
      currency: currency.toLowerCase(),
      ...(isRecurring ? {
        recurring: {
          interval: interval as 'month' | 'year',
        },
      } : {}),
    })
  }

  async createCheckoutSession(opts: {
    customerId: string
    priceId: string
    successUrl: string
    cancelUrl: string
    metadata?: Record<string, string>
  }) {
    return this.client.checkout.sessions.create({
      customer: opts.customerId,
      mode: 'subscription',
      line_items: [{ price: opts.priceId, quantity: 1 }],
      success_url: opts.successUrl,
      cancel_url: opts.cancelUrl,
      metadata: opts.metadata,
      subscription_data: {
        metadata: opts.metadata,
      },
    })
  }

  async createBillingPortalSession(customerId: string, returnUrl: string) {
    return this.client.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    })
  }

  // Deferred, not immediate — matches Paddle (`effective_from: 'next_billing_period'`) and
  // LemonSqueezy's own DELETE semantics, so a canceling customer keeps access through the
  // period they already paid for on every provider, not just those two. The real,
  // provider-side cancellation still happens automatically at period end; Stripe fires
  // `customer.subscription.deleted` at that point, which cancelSubscriptionFromWebhook
  // handles the same way as it always has.
  async cancelSubscription(subscriptionId: string) {
    return this.client.subscriptions.update(subscriptionId, { cancel_at_period_end: true })
  }

  async getSubscription(subscriptionId: string) {
    return this.client.subscriptions.retrieve(subscriptionId)
  }

  async constructWebhookEvent(payload: string, signature: string, secret: string) {
    return this.client.webhooks.constructEventAsync(payload, signature, secret)
  }
}
