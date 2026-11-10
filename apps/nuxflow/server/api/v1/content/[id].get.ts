import { useDb } from '../../../utils/db'
import { requireAuth, canEditContentItem } from '../../../utils/permissions'
import { getContentItemOrThrow } from '../../../utils/content-queries'
import { contentTypes } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { getContentTermIds } from '../../../utils/taxonomy'
import { settingsForEditor } from '../../../utils/page-password'
import { requireSiteId } from '../../../utils/site-context'
import { loadProduct, productForEditor } from '../../../utils/products'
import { getShopSettings } from '../../../utils/shop'

export default defineEventHandler(async (event) => {
  const { userId, role } = await requireAuth(event)
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const id = getRouterParam(event, 'id')!

  const item = await getContentItemOrThrow(db, siteId, id, 'Not found')

  const [type, termIds, product] = await Promise.all([
    db.query.contentTypes.findFirst({
      where: and(eq(contentTypes.id, item.typeId), eq(contentTypes.siteId, siteId)),
      columns: { hasComments: true, slug: true },
    }),
    getContentTermIds(db, id),
    loadProduct(db, siteId, id),
  ])
  const shop = product.product || type?.slug === 'product' ? await getShopSettings(event) : null

  // Lets the editor show a read-only notice up front instead of failing on save —
  // PATCH enforces the same rule (canEditContentItem) server-side.
  return {
    ...item,
    // The page password's hash never leaves the server; the editor only needs to know one is set.
    settings: settingsForEditor(item.settings as Record<string, unknown> | null),
    typeHasComments: type?.hasComments ?? false,
    typeSlug: type?.slug ?? 'page',
    termIds,
    // A product's options and variants; null for anything else, and for a translation.
    product: productForEditor(product),
    // The shop's currency, which every product price is in.
    shopCurrency: shop?.currency ?? null,
    canEdit: canEditContentItem(role, userId, item),
  }
})
