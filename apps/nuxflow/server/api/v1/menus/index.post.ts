import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { requireAuth } from '../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../utils/audit'
import { menus } from '@nuxflow/db/schema'
import { ulid } from 'ulid'
import { purgeEdgeCache, purgeAllPublicPages } from '../../../utils/edge-cache'
import { waitUntil } from '../../../utils/cf-env'

const bodySchema = z.object({
  name: z.string().min(1).max(100),
  location: z.enum(['header', 'footer', 'sidebar']).nullish(),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireAuth(event)
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const body = await parseBody(event, bodySchema)

  const id = ulid()
  const menuInsert = db.insert(menus).values({ id, siteId, name: body.name, location: body.location ?? null, items: [] })

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'create',
    resource: 'menu',
    resourceId: id,
    after: { name: body.name, location: body.location ?? null },
  })

  await batchWithAudit(db, [menuInsert], auditInsert)

  if (body.location) {
    await purgeEdgeCache(event, [`/api/public/menus/${body.location}`])
    // header/footer menus render into every page's shared chrome via the layout — a
    // single named path isn't enough once full pages (not just their own JSON data) are
    // cached. See purgeAllPublicPages' own docs for why this can't be more targeted.
    if (body.location === 'header' || body.location === 'footer') {
      waitUntil(event, purgeAllPublicPages(event, siteId).catch((err) => {
        console.error('[menus] Failed to purge page cache after menu create:', err)
      }))
    }
  }

  return { id }
})
