import Stripe from 'stripe'
import type { PaymentProvider } from './types'

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
      unit_amount: Math.round(unitAmount * 100),
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

  async cancelSubscription(subscriptionId: string) {
    return this.client.subscriptions.cancel(subscriptionId)
  }

  async constructWebhookEvent(payload: string, signature: string, secret: string) {
    return this.client.webhooks.constructEventAsync(payload, signature, secret)
  }
}
