import { useDb } from '../../../../../utils/db'
import { requireRole } from '../../../../../utils/permissions'
import { getEmailMessageOrThrow } from '../../../../../utils/inbox'
import { getCfBindings } from '../../../../../utils/cf-env'

/**
 * Downloads one attachment of a received message. Always served as a download
 * (Content-Disposition: attachment) with a sandbox CSP and nosniff — the file comes from
 * an arbitrary outside sender and is served from the admin's own origin, so it must never
 * render inline (an HTML or SVG attachment would otherwise run in the admin's session).
 */
export default defineEventHandler(async (event) => {
  await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!
  const index = Number(getRouterParam(event, 'index'))

  const message = await getEmailMessageOrThrow(db, siteId, id)
  const attachment = Number.isInteger(index) ? message.attachments?.[index] : undefined
  if (!attachment?.key) notFound('Attachment not found')

  const { r2 } = getCfBindings(event)
  const object = r2 ? await r2.get(attachment.key) : null
  if (!object) notFound('Attachment not found')

  // RFC 6266/5987 — ASCII fallback plus the UTF-8 original.
  const asciiName = attachment.filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_')
  setHeaders(event, {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
    'Content-Length': String(object.size),
    'Content-Security-Policy': 'sandbox; default-src \'none\'',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  })
  return object.body
})
