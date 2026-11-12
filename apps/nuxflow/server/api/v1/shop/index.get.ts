import { and, count, eq } from 'drizzle-orm'
import { contentTypes, products } from '@nuxflow/db/schema'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { requireSiteId } from '../../../utils/site-context'
import { getShopSettings } from '../../../utils/shop'
import { planIncludes } from '../../../utils/hosting-plans'
import { bookingPaymentsReady } from '../../../utils/class-passes'
import type { ShopStatus } from '../../../../shared/lib/shop-types'

// Admin → Shop: the switch, the settings, and whether payments are ready to take. Editors
// read it too: the product editor needs the shop's currency. Changing it is admin-only.
export default defineEventHandler(async (event) => {
  await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const [settings, inPlan, paymentsReady, [productCount], productType] = await Promise.all([
    getShopSettings(event),
    planIncludes(db, siteId, 'shop'),
    bookingPaymentsReady(event),
    db.select({ n: count() }).from(products).where(eq(products.siteId, siteId)),
    db.query.contentTypes.findFirst({ where: and(eq(contentTypes.siteId, siteId), eq(contentTypes.slug, 'product')), columns: { id: true } }),
  ])
  return { settings, inPlan, paymentsReady, productCount: productCount?.n ?? 0, hasProductType: Boolean(productType) } satisfies ShopStatus
})
