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

  // The link must point at THIS site's domain — the token only resolves against the
  // site it was issued for (see preview/[token].get.ts), and the deployment-wide
  // `siteUrl` is some other site's domain on every secondary site of a multi-site install.
  const baseUrl = getRequestURL(event).origin

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'generate',
    resource: 'preview_link',
    resourceId: id,
  })
  await batchWithAudit(db, [tokenUpdate], auditInsert)

  return { url: `${baseUrl}/api/preview/${token}` }
})
