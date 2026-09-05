import { z } from 'zod'
import { membershipTiers } from '@nuxflow/db/schema'
import { useDb } from '../../../utils/db'
import { scopedById } from '../../../utils/db-helpers'
import { requireRole } from '../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../utils/audit'
import { getMembershipTierByIdOrThrow } from '../../../utils/resource-queries'
import { resolveSetting } from '../../../utils/settings'
import { StripeProvider } from '../../../utils/payments/stripe'
import { LemonSqueezyProvider } from '../../../utils/payments/lemonsqueezy'
import { syncPaymentProvider } from '../../../utils/payments/sync'

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
  lsProductId: z.string().optional(),
  lsVariantId: z.string().optional(),
  paddleProductId: z.string().optional(),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!
  const body = await parseBody(event, bodySchema)

  const tier = await getMembershipTierByIdOrThrow(db, siteId, id)

  let stripeProductId = body.stripeProductId !== undefined ? body.stripeProductId : tier.stripeProductId
  let stripePriceId = body.stripePriceId !== undefined ? body.stripePriceId : tier.stripePriceId
  let lsProductId = body.lsProductId !== undefined ? body.lsProductId : tier.lsProductId
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
      await syncPaymentProvider('Stripe', 'tier update', async () => {
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
      })
    }

    // ── Lemon Squeezy sync ────────────────────────────────────────────────
    const lsApiKey = await resolveSetting(event, 'payments.ls_api_key', 'lsApiKey')
    const lsStoreId = await resolveSetting(event, 'payments.ls_store_id', 'lsStoreId')
    if (lsApiKey && lsStoreId) {
      await syncPaymentProvider('Lemon Squeezy', 'tier update', async () => {
        const ls = new LemonSqueezyProvider(lsApiKey, lsStoreId)
        const priceChanged = body.price !== undefined && body.price !== tier.price
        const intervalChanged = body.interval !== undefined && body.interval !== tier.interval

        // Reuse the existing LS product across edits (mirrors the Stripe path above) —
        // only the first-ever sync should mint a new product. Without a stored
        // `lsProductId`, every price/interval change used to create a brand-new product
        // because there was nowhere to persist the id returned by the first sync.
        if (!lsProductId) {
          const product = await ls.createProduct(targetName, targetDescription)
          lsProductId = product.data.id
        }

        if (!lsVariantId || priceChanged || intervalChanged) {
          // First variant, or price/interval changed — mint a new variant under the
          // existing product; existing subscriptions keep the old variant so their price
          // doesn't change retroactively.
          const variant = await ls.createVariant(lsProductId, targetName, targetPrice, targetInterval)
          lsVariantId = variant.data.id
        }
      })
    }
  }

  const update = db.update(membershipTiers)
    .set({
      ...body,
      stripeProductId: stripeProductId || null,
      stripePriceId: stripePriceId || null,
      lsProductId: lsProductId || null,
      lsVariantId: lsVariantId || null,
      updatedAt: new Date().toISOString(),
    })
    .where(scopedById(membershipTiers.id, id, membershipTiers.siteId, siteId))

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'update', resource: 'membership_tier', resourceId: id, before: tier, after: body,
  })
  await batchWithAudit(db, [update], auditInsert)

  const updated = await db.query.membershipTiers.findFirst({
    where: (t, { eq: eq_ }) => eq_(t.id, id),
  })
  return updated
})
