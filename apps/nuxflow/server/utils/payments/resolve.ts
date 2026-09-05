import type { H3Event } from 'h3'
import { resolveSetting } from '../settings'
import { StripeProvider } from './stripe'
import { LemonSqueezyProvider } from './lemonsqueezy'
import { PaddleProvider } from './paddle'
import type { PaymentProvider, PaymentProviderName } from './types'

/** Constructs a StripeProvider from site settings, or returns null if unconfigured. */
export async function resolveStripeProvider(event: H3Event): Promise<StripeProvider | null> {
  const secretKey = await resolveSetting(event, 'payments.stripe_secret_key', 'stripeSecretKey')
  return secretKey ? new StripeProvider(secretKey) : null
}

/** Same as resolveStripeProvider, but throws the standard 503 instead of returning null. */
export async function getStripeProvider(event: H3Event): Promise<StripeProvider> {
  const provider = await resolveStripeProvider(event)
  if (!provider) throw createError({ statusCode: 503, message: 'Stripe is not configured' })
  return provider
}

/** Constructs a LemonSqueezyProvider from site settings, or returns null if unconfigured. */
export async function resolveLemonSqueezyProvider(event: H3Event): Promise<LemonSqueezyProvider | null> {
  const apiKey = await resolveSetting(event, 'payments.ls_api_key', 'lsApiKey')
  const storeId = await resolveSetting(event, 'payments.ls_store_id', 'lsStoreId')
  return apiKey && storeId ? new LemonSqueezyProvider(apiKey, storeId) : null
}

/** Same as resolveLemonSqueezyProvider, but throws the standard 503 instead of returning null. */
export async function getLemonSqueezyProvider(event: H3Event): Promise<LemonSqueezyProvider> {
  const provider = await resolveLemonSqueezyProvider(event)
  if (!provider) throw createError({ statusCode: 503, message: 'Lemon Squeezy is not configured' })
  return provider
}

/** Constructs a PaddleProvider from site settings, or returns null if unconfigured. */
export async function resolvePaddleProvider(event: H3Event): Promise<PaddleProvider | null> {
  const apiKey = await resolveSetting(event, 'payments.paddle_api_key', 'paddleApiKey')
  const vendorId = await resolveSetting(event, 'payments.paddle_vendor_id', 'paddleVendorId')
  if (!apiKey || !vendorId) return null
  const sandbox = await resolveSetting(event, 'payments.paddle_sandbox')
  return new PaddleProvider(apiKey, vendorId, sandbox === 'true')
}

/** Same as resolvePaddleProvider, but throws the standard 503 instead of returning null. */
export async function getPaddleProvider(event: H3Event): Promise<PaddleProvider> {
  const provider = await resolvePaddleProvider(event)
  if (!provider) throw createError({ statusCode: 503, message: 'Paddle is not configured' })
  return provider
}

/** Resolves whichever provider name is given, throwing the standard 503 if it isn't configured. */
export async function getConfiguredPaymentProvider(event: H3Event, provider: PaymentProviderName): Promise<PaymentProvider> {
  switch (provider) {
    case 'stripe': return getStripeProvider(event)
    case 'lemonsqueezy': return getLemonSqueezyProvider(event)
    case 'paddle': return getPaddleProvider(event)
  }
}
