import { z } from 'zod'
import { membershipTiers } from '@nuxflow/db/schema'
import { ulid } from 'ulid'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { resolveSetting } from '../../../utils/settings'
import { StripeProvider } from '../../../utils/payments/stripe'
import { LemonSqueezyProvider } from '../../../utils/payments/lemonsqueezy'

const bodySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  price: z.number().min(0),
  currency: z.string().length(3).default('USD'),
  interval: z.enum(['month', 'year', 'one_time']).default('month'),
  features: z.array(z.string()).default([]),
  isActive: z.boolean().default(true),
  stripeProductId: z.string().optional(),
  stripePriceId: z.string().optional(),
  lsVariantId: z.string().optional(),
  paddleProductId: z.string().optional(),
})

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const body = await readValidatedBody(event, bodySchema.parse)

  let stripeProductId = body.stripeProductId
  let stripePriceId = body.stripePriceId
  let lsVariantId = body.lsVariantId

  if (body.price > 0) {
    // Auto-sync to Stripe if configured and not manually provided
    if (!stripePriceId) {
      const stripeSecretKey = await resolveSetting(event, 'payments.stripe_secret_key', 'stripeSecretKey')
      if (stripeSecretKey) {
        try {
          const stripe = new StripeProvider(stripeSecretKey)
          const product = await stripe.createProduct(body.name, body.description || undefined)
          const price = await stripe.createPrice(product.id, body.price, body.currency, body.interval)
          stripeProductId = product.id
          stripePriceId = price.id
        } catch (err) {
          console.error('[stripe] Auto-sync failed on tier creation:', err)
          throw createError({
            statusCode: 400,
            message: `Stripe synchronization failed: ${(err as Error).message}`,
          })
        }
      }
    }

    // Auto-sync to Lemon Squeezy if configured and not manually provided
    if (!lsVariantId) {
      const lsApiKey = await resolveSetting(event, 'payments.ls_api_key', 'lsApiKey')
      const lsStoreId = await resolveSetting(event, 'payments.ls_store_id', 'lsStoreId')
      if (lsApiKey && lsStoreId) {
        try {
          const ls = new LemonSqueezyProvider(lsApiKey, lsStoreId)
          const product = await ls.createProduct(body.name, body.description || undefined)
          const variant = await ls.createVariant(product.data.id, body.name, body.price, body.interval)
          lsVariantId = variant.data.id
        } catch (err) {
          console.error('[lemonsqueezy] Auto-sync failed on tier creation:', err)
          throw createError({
            statusCode: 400,
            message: `Lemon Squeezy synchronization failed: ${(err as Error).message}`,
          })
        }
      }
    }
  }

  const id = ulid()
  await db.insert(membershipTiers).values({
    id,
    siteId,
    name: body.name,
    description: body.description ?? null,
    price: body.price,
    currency: body.currency,
    interval: body.interval,
    features: body.features,
    isActive: body.isActive,
    stripeProductId: stripeProductId || null,
    stripePriceId: stripePriceId || null,
    lsVariantId: lsVariantId || null,
    paddleProductId: body.paddleProductId || null,
  })

  const tier = await db.query.membershipTiers.findFirst({
    where: (t, { eq: eq_ }) => eq_(t.id, id),
  })

  setResponseStatus(event, 201)
  return tier
})
