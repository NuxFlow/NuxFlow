import Stripe from 'stripe'
import type { PaymentProvider } from './types'
import { fromMinorUnits, toMinorUnits } from '../../../shared/lib/money'

/**
 * Tier prices are stored in major units (e.g. 9.99). Stripe wants the smallest currency
 * unit, which is not always cents: ¥1000 is unit_amount 1000, not 100000, and three-decimal
 * currencies use thousandths with the last digit 0. The rules live in shared/lib/money.ts.
 */
export const toStripeUnitAmount = toMinorUnits

/** The other way round: what a webhook's smallest-unit amount is in major units. */
export const fromStripeUnitAmount = fromMinorUnits

export class StripeProvider implements PaymentProvider {
  private client: Stripe

  constructor(secretKey: string) {
    this.client = new Stripe(secretKey)
  }

  // Customers are per (email, site), tagged via metadata. One Stripe account can back
  // several NuxFlow sites (the operator's own sites share the deployment's key), and a
  // billing-portal session shows *every* subscription on its customer — a customer shared
  // across sites let a member of one site see and cancel their subscriptions on another.
  async createCustomer(email: string, name: string, siteId: string) {
    return this.client.customers.create({ email, name, metadata: { nuxflowSiteId: siteId } })
  }

  async findCustomerForSite(email: string, siteId: string) {
    const result = await this.client.customers.list({ email, limit: 100 })
    return result.data.find(c => c.metadata?.nuxflowSiteId === siteId) ?? null
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
    /** Free days before the first charge; the card is still taken at checkout. */
    trialDays?: number
    /** Flexible billing mode, which Stripe needs to pause a subscription after failed payments. */
    flexibleBilling?: boolean
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
        ...(opts.trialDays ? { trial_period_days: opts.trialDays } : {}),
        ...(opts.flexibleBilling ? { billing_mode: { type: 'flexible' as const } } : {}),
      },
    })
  }

  /**
   * A one-off payment rather than a subscription: a one-time membership tier (`priceId`), or
   * a booking or class pass (`item`, priced at the moment of checkout so nothing has to be
   * synced to Stripe first). A guest gets `customerEmail`, with no Stripe customer made.
   * `expiresInMinutes` can't be under Stripe's minimum of 30.
   *
   * Card only: a booking takes a place straight away, and slower methods such as bank debits
   * would hold that place for days and could still fail after the class has happened.
   */
  async createPaymentCheckout(opts: {
    customerId?: string
    customerEmail?: string
    priceId?: string
    item?: { name: string; description?: string; amount: number; currency: string; quantity: number }
    successUrl: string
    cancelUrl: string
    metadata: Record<string, string>
    expiresInMinutes?: number
  }) {
    const params: Stripe.Checkout.SessionCreateParams = {
      mode: 'payment',
      allowed_payment_method_types: ['card'],
      line_items: [opts.item
        ? {
            quantity: opts.item.quantity,
            price_data: {
              currency: opts.item.currency.toLowerCase(),
              unit_amount: toStripeUnitAmount(opts.item.amount, opts.item.currency),
              product_data: { name: opts.item.name, ...(opts.item.description ? { description: opts.item.description } : {}) },
            },
          }
        : { price: opts.priceId, quantity: 1 }],
      success_url: opts.successUrl,
      cancel_url: opts.cancelUrl,
      metadata: opts.metadata,
      payment_intent_data: { metadata: opts.metadata },
    }
    if (opts.customerId) params.customer = opts.customerId
    else params.customer_email = opts.customerEmail
    if (opts.expiresInMinutes) params.expires_at = Math.floor(Date.now() / 1000) + opts.expiresInMinutes * 60
    return this.client.checkout.sessions.create(params)
  }

  /**
   * A shop basket: several lines priced now (nothing is synced to Stripe first), one delivery
   * option when something has to be posted, and optionally Stripe Tax. Amounts are minor
   * units. Card only, like bookings: stock is kept while they pay, and a slow bank payment
   * would keep it for days and could still fail.
   */
  async createOrderCheckout(opts: {
    customerEmail?: string
    currency: string
    lines: { name: string; description?: string; image?: string; unitMinor: number; quantity: number }[]
    /** Null: nothing to post, so no address is asked for. */
    shipping: { countries: string[]; label: string; amountMinor: number } | null
    automaticTax: boolean
    pricesIncludeTax: boolean
    successUrl: string
    cancelUrl: string
    metadata: Record<string, string>
    expiresInMinutes: number
  }) {
    const currency = opts.currency.toLowerCase()
    const taxBehavior = opts.pricesIncludeTax ? 'inclusive' as const : 'exclusive' as const
    const params: Stripe.Checkout.SessionCreateParams = {
      mode: 'payment',
      allowed_payment_method_types: ['card'],
      line_items: opts.lines.map(line => ({
        quantity: line.quantity,
        price_data: {
          currency,
          unit_amount: line.unitMinor,
          tax_behavior: taxBehavior,
          product_data: {
            name: line.name,
            ...(line.description ? { description: line.description } : {}),
            ...(line.image ? { images: [line.image] } : {}),
          },
        },
      })),
      success_url: opts.successUrl,
      cancel_url: opts.cancelUrl,
      metadata: opts.metadata,
      payment_intent_data: { metadata: opts.metadata },
      expires_at: Math.floor(Date.now() / 1000) + opts.expiresInMinutes * 60,
      automatic_tax: { enabled: opts.automaticTax },
    }
    if (opts.customerEmail) params.customer_email = opts.customerEmail
    if (opts.shipping) {
      params.shipping_address_collection = { allowed_countries: opts.shipping.countries as Stripe.Checkout.SessionCreateParams.ShippingAddressCollection.AllowedCountry[] }
      params.shipping_options = [{
        shipping_rate_data: {
          type: 'fixed_amount',
          fixed_amount: { amount: opts.shipping.amountMinor, currency },
          display_name: opts.shipping.label,
          tax_behavior: taxBehavior,
        },
      }]
    }
    // Stripe Tax needs to know where the buyer is; with nothing posted, that's their billing address.
    else if (opts.automaticTax) params.billing_address_collection = 'required'
    return this.client.checkout.sessions.create(params)
  }

  async getCheckoutSession(sessionId: string) {
    return this.client.checkout.sessions.retrieve(sessionId)
  }

  async expireCheckoutSession(sessionId: string) {
    return this.client.checkout.sessions.expire(sessionId)
  }

  /**
   * Gives money back; the whole payment unless `amount` (major units) says otherwise.
   * `idempotencyKey` makes a retry or a double click refund once, not twice.
   */
  async refundPayment(opts: { paymentIntentId: string; amount?: number; currency?: string; idempotencyKey: string }) {
    return this.client.refunds.create(
      {
        payment_intent: opts.paymentIntentId,
        ...(opts.amount !== undefined && opts.currency ? { amount: toStripeUnitAmount(opts.amount, opts.currency) } : {}),
      },
      { idempotencyKey: opts.idempotencyKey },
    )
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

  /** Ends a subscription now, with no further charges — for when what it paid for is gone. */
  async cancelSubscriptionNow(subscriptionId: string) {
    return this.client.subscriptions.cancel(subscriptionId)
  }

  async archivePrice(priceId: string) {
    return this.client.prices.update(priceId, { active: false })
  }

  async getSubscription(subscriptionId: string) {
    return this.client.subscriptions.retrieve(subscriptionId)
  }

  async constructWebhookEvent(payload: string, signature: string, secret: string) {
    return this.client.webhooks.constructEventAsync(payload, signature, secret)
  }
}
