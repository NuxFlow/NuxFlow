import { z } from 'zod'
import { useReplicaDb } from '../../../utils/db'
import { requireSiteId } from '../../../utils/site-context'
import { getSiteInfo } from '../../../utils/site-info'
import { getShopSettings, requireShopOn } from '../../../utils/shop'
import { listProductCards, liveStock } from '../../../utils/products'

const querySchema = z.object({
  // Live stock for one product's page, which is cached whole.
  product: z.string().min(1).max(64).optional(),
  // Otherwise a list for the Products and Product blocks.
  collection: z.string().trim().max(200).optional(),
  // Comma-separated product slugs, in the order to show them.
  slugs: z.string().max(2000).optional(),
  limit: z.coerce.number().int().min(1).max(48).default(12),
})

// The shop's public reads. A few seconds' staleness from a read replica is fine for both:
// checkout checks every price and stock level again on the primary.
export default defineEventHandler(async (event) => {
  await requireShopOn(event)
  const query = parseQuery(event, querySchema)
  const db = useReplicaDb(event)
  const siteId = requireSiteId(event)

  if (query.product) {
    setHeader(event, 'Cache-Control', 'no-store')
    return { variants: await liveStock(db, siteId, query.product) }
  }

  const [shop, site] = await Promise.all([getShopSettings(event), getSiteInfo(event, siteId)])
  setHeader(event, 'Cache-Control', 'public, max-age=60')
  const slugs = query.slugs?.split(',').map(s => s.trim()).filter(Boolean).slice(0, 48)
  const products = await listProductCards(db, siteId, {
    limit: query.limit,
    collection: query.collection || undefined,
    slugs,
    currency: shop.currency,
    locale: site?.locale || 'en',
  })
  return { products, currency: shop.currency }
})
