export type SubscriptionStatus = 'active' | 'cancelled' | 'past_due' | 'trialing' | 'unpaid'

export type PaymentProviderName = 'stripe' | 'lemonsqueezy' | 'paddle'

/**
 * The one operation genuinely shared across all three providers with an identical
 * shape. Checkout creation and product/price sync are deliberately NOT part of this
 * interface — Stripe and Lemon Squeezy drive checkout through their APIs, while Paddle
 * (as integrated here) redirects to a classic overlay checkout URL and never calls its
 * own API for it. Forcing a single `createCheckoutSession` shape across all three would
 * misrepresent that difference rather than remove real duplication.
 */
export interface PaymentProvider {
  cancelSubscription(subscriptionId: string): Promise<unknown>
}
