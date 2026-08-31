import { useDb } from '../../../../utils/db'
import { contentItems } from '@nuxflow/db/schema'
import { requireRole } from '../../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../../utils/audit'
import { getContentItemOrThrow } from '../../../../utils/content-queries'
import { scopedById } from '../../../../utils/db-helpers'
import { ulid } from 'ulid'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'author')
  const siteId = event.context.siteId!
  const id = getRouterParam(event, 'id')!

  const db = useDb(event)

  await getContentItemOrThrow(db, siteId, id, 'Content not found')

  const token = ulid().toLowerCase()
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()

  const tokenUpdate = db
    .update(contentItems)
    .set({ previewToken: token, previewTokenExpiresAt: expiresAt })
    .where(scopedById(contentItems.id, id, contentItems.siteId, siteId))

  const config = useRuntimeConfig()
  const baseUrl = config.public.siteUrl || 'http://localhost:3000'

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'generate',
    resource: 'preview_link',
    resourceId: id,
  })
  await batchWithAudit(db, [tokenUpdate], auditInsert)

  return { url: `${baseUrl}/api/preview/${token}` }
})
