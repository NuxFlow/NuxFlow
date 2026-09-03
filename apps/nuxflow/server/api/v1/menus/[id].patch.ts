import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { requireAuth } from '../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../utils/audit'
import { getMenuByIdOrThrow } from '../../../utils/resource-queries'
import { menus } from '@nuxflow/db/schema'
import { sql } from 'drizzle-orm'
import { scopedById } from '../../../utils/db-helpers'
import { purgeEdgeCache, purgeAllPublicPages } from '../../../utils/edge-cache'
import { waitUntil } from '../../../utils/cf-env'

const menuItemSchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    id: z.string().optional(),
    label: z.string(),
    type: z.enum(['page', 'url']).optional(),
    url: z.string().optional(),
    contentId: z.string().optional(),
    slug: z.string().optional(),
    target: z.enum(['_self', '_blank']).default('_self'),
    children: z.array(z.object({
      id: z.string().optional(),
      label: z.string(),
      type: z.enum(['page', 'url']).optional(),
      url: z.string().optional(),
      contentId: z.string().optional(),
      slug: z.string().optional(),
      target: z.enum(['_self', '_blank']).default('_self'),
    })).default([]),
  }),
)

const bodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  location: z.enum(['header', 'footer', 'sidebar']).nullish(),
  items: z.array(menuItemSchema).optional(),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireAuth(event)
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!
  const body = await parseBody(event, bodySchema)

  const existing = await getMenuByIdOrThrow(db, siteId, id)

  const menuUpdate = db.update(menus)
    .set({
      ...(body.name !== undefined && { name: body.name }),
      ...('location' in body && { location: body.location ?? null }),
      ...(body.items !== undefined && { items: body.items as unknown[] }),
      updatedAt: sql`(datetime('now'))`,
    })
    .where(scopedById(menus.id, id, menus.siteId, siteId))

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'update',
    resource: 'menu',
    resourceId: id,
    before: existing,
    after: body,
  })

  await batchWithAudit(db, [menuUpdate], auditInsert)

  const newLocation = 'location' in body ? (body.location ?? null) : existing.location
  const locations = [...new Set([existing.location, newLocation].filter((l): l is string => Boolean(l)))]
  await purgeEdgeCache(event, locations.map(l => `/api/public/menus/${l}`))

  // header/footer menus render into every page's shared chrome — covers both a location
  // change and an in-place items edit on a menu that's already assigned to header/footer.
  if (locations.includes('header') || locations.includes('footer')) {
    waitUntil(event, purgeAllPublicPages(event, siteId).catch((err) => {
      console.error('[menus] Failed to purge page cache after menu update:', err)
    }))
  }

  return { ok: true }
})
