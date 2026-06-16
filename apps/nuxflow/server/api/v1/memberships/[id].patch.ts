import { z } from 'zod'
import { membershipTiers } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { resolveSetting } from '../../../utils/settings'
import { StripeProvider } from '../../../utils/payments/stripe'
import { LemonSqueezyProvider } from '../../../utils/payments/lemonsqueezy'

const bodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  price: z.number().min(0).optional(),
  currency: z.string().length(3).optional(),
  interval: z.enum(['month', 'year', 'one_time']).optional(),
  features: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
  stripeProductId: z.string().optional(),
  stripePriceId: z.string().optional(),
  lsVariantId: z.string().optional(),
  paddleProductId: z.string().optional(),
})

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!
  const body = await readValidatedBody(event, bodySchema.parse)

  const tier = await db.query.membershipTiers.findFirst({
    where: and(eq(membershipTiers.id, id), eq(membershipTiers.siteId, siteId)),
  })
  if (!tier) throw createError({ statusCode: 404, message: 'Membership tier not found' })

  let stripeProductId = body.stripeProductId !== undefined ? body.stripeProductId : tier.stripeProductId
  let stripePriceId = body.stripePriceId !== undefined ? body.stripePriceId : tier.stripePriceId
  let lsVariantId = body.lsVariantId !== undefined ? body.lsVariantId : tier.lsVariantId

  const targetPrice = body.price !== undefined ? body.price : tier.price
  const targetCurrency = body.currency !== undefined ? body.currency : tier.currency
  const targetInterval = body.interval !== undefined ? body.interval : tier.interval
  const targetName = body.name !== undefined ? body.name : tier.name
  const targetDescription = body.description !== undefined ? body.description : (tier.description ?? undefined)

  if (targetPrice > 0) {
    // ── Stripe sync ────────────────────────────────────────────────────────
    const stripeSecretKey = await resolveSetting(event, 'payments.stripe_secret_key', 'stripeSecretKey')
    if (stripeSecretKey) {
      try {
        const stripe = new StripeProvider(stripeSecretKey)
        if (!stripeProductId) {
          const product = await stripe.createProduct(targetName, targetDescription)
          const price = await stripe.createPrice(product.id, targetPrice, targetCurrency, targetInterval)
          stripeProductId = product.id
          stripePriceId = price.id
        } else {
          if (body.name !== undefined || body.description !== undefined) {
            await stripe.updateProduct(stripeProductId, targetName, targetDescription)
          }
          const priceChanged = body.price !== undefined && body.price !== tier.price
          const currencyChanged = body.currency !== undefined && body.currency !== tier.currency
          const intervalChanged = body.interval !== undefined && body.interval !== tier.interval
          if (priceChanged || currencyChanged || intervalChanged || !stripePriceId) {
            const price = await stripe.createPrice(stripeProductId, targetPrice, targetCurrency, targetInterval)
            stripePriceId = price.id
          }
        }
      } catch (err) {
        console.error('[stripe] Auto-sync failed on tier update:', err)
        throw createError({
          statusCode: 400,
          message: `Stripe synchronization failed: ${(err as Error).message}`,
        })
      }
    }

    // ── Lemon Squeezy sync ────────────────────────────────────────────────
    const lsApiKey = await resolveSetting(event, 'payments.ls_api_key', 'lsApiKey')
    const lsStoreId = await resolveSetting(event, 'payments.ls_store_id', 'lsStoreId')
    if (lsApiKey && lsStoreId) {
      try {
        const ls = new LemonSqueezyProvider(lsApiKey, lsStoreId)
        const priceChanged = body.price !== undefined && body.price !== tier.price
        const intervalChanged = body.interval !== undefined && body.interval !== tier.interval

        if (!lsVariantId) {
          // No variant yet — create product + variant
          const product = await ls.createProduct(targetName, targetDescription)
          const variant = await ls.createVariant(product.data.id, targetName, targetPrice, targetInterval)
          lsVariantId = variant.data.id
        } else if (priceChanged || intervalChanged) {
          // Price or interval changed — create a new product + variant (existing subscriptions keep the old one)
          const product = await ls.createProduct(targetName, targetDescription)
          const variant = await ls.createVariant(product.data.id, targetName, targetPrice, targetInterval)
          lsVariantId = variant.data.id
        }
      } catch (err) {
        console.error('[lemonsqueezy] Auto-sync failed on tier update:', err)
        throw createError({
          statusCode: 400,
          message: `Lemon Squeezy synchronization failed: ${(err as Error).message}`,
        })
      }
    }
  }

  await db.update(membershipTiers)
    .set({
      ...body,
      stripeProductId: stripeProductId || null,
      stripePriceId: stripePriceId || null,
      lsVariantId: lsVariantId || null,
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(membershipTiers.id, id), eq(membershipTiers.siteId, siteId)))

  const updated = await db.query.membershipTiers.findFirst({
    where: (t, { eq: eq_ }) => eq_(t.id, id),
  })
  return updated
})
