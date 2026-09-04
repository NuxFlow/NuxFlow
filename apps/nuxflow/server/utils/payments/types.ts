export type SubscriptionStatus = 'active' | 'cancelled' | 'past_due' | 'trialing' | 'unpaid'

export type PaymentProviderName = 'stripe' | 'lemonsqueezy' | 'paddle'

/**
 * The one operation genuinely shared across all three providers with an identical
 * shape. Checkout creation and product/price sync are deliberately NOT part of this
 * interface — all three drive checkout through their own API and return a hosted
 * checkout URL to redirect the browser to (Stripe's `checkout.sessions`, LS's
 * `createCheckout`, Paddle's `createTransaction`), but each takes different inputs
 * (customer id vs. email vs. nothing, differing metadata shapes) and Paddle's is a
 * transaction rather than a session, so forcing a single `createCheckoutSession` shape
 * across all three would misrepresent that difference rather than remove real
 * duplication.
 */
export interface PaymentProvider {
  cancelSubscription(subscriptionId: string): Promise<unknown>
}
