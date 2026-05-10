import Stripe from 'stripe'

export class StripeProvider {
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
    })
  }

  async createBillingPortalSession(customerId: string, returnUrl: string) {
    return this.client.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    })
  }

  constructWebhookEvent(payload: Buffer, signature: string, secret: string) {
    return this.client.webhooks.constructEvent(payload, signature, secret)
  }
}
