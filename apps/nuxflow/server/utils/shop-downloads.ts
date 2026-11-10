import type { H3Event } from 'h3'
import { and, eq, sql } from 'drizzle-orm'
import { ulid } from 'ulid'
import { orderLines, orders, productVariants } from '@nuxflow/db/schema'
import { useDb } from './db'
import { requireSiteId } from './site-context'
import { getCfBindings } from './cf-env'
import { assertWithinPlan } from './hosting-plans'
import { getShopSettings } from './shop'
import { bookingOrigin } from './class-passes'
import { hmacSha256Hex, constantTimeEqualHex } from './webhook-crypto'

/**
 * Digital products. A variant's file sits in the media bucket under `_private/<siteId>/shop/`,
 * outside the public media route's `<siteId>/` prefix, so it can only be reached through a
 * signed link from a paid order, a limited number of times, for a limited number of days.
 * Site deletion and site moves already cover `_private/<siteId>/`.
 */

/** A Worker can't take a request body over 100 MB. */
export const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024

function fileKey(siteId: string, variantId: string, name: string): string {
  const safe = name.normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').slice(-100) || 'file'
  return `_private/${siteId}/shop/${variantId}/${ulid()}-${safe}`
}

/** Puts a variant's file in place, replacing any it had. */
export async function uploadVariantFile(event: H3Event, variantId: string, file: { name: string; type?: string; data: Uint8Array }): Promise<{ fileName: string; fileSize: number }> {
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const { r2 } = getCfBindings(event)
  if (!r2) httpError({ status: 409, message: 'Downloads need file storage (the MEDIA_BUCKET binding), which this site doesn\'t have.', data: { code: 'storage_required' } })
  if (!file.data.byteLength) validationError('That file is empty.')
  if (file.data.byteLength > MAX_DOWNLOAD_BYTES) httpError({ status: 413, message: 'A download can be up to 100 MB.' })

  const variant = await db.query.productVariants.findFirst({ where: and(eq(productVariants.id, variantId), eq(productVariants.siteId, siteId)) })
  if (!variant) notFound('Save the product first, then add its file.')
  if (variant.kind !== 'digital') validationError('Only a download variant can have a file.')
  await assertWithinPlan(event, 'storage', Math.max(0, file.data.byteLength - (variant.fileSize ?? 0)))

  const key = fileKey(siteId, variantId, file.name)
  const name = file.name.slice(0, 200) || 'download'
  await r2.put(key, file.data, {
    httpMetadata: { contentType: file.type || 'application/octet-stream', contentDisposition: `attachment; filename="${name.replace(/["\\\r\n]/g, '_')}"` },
  })
  await db.update(productVariants)
    .set({ fileKey: key, fileName: name, fileSize: file.data.byteLength, updatedAt: new Date().toISOString() })
    .where(and(eq(productVariants.id, variantId), eq(productVariants.siteId, siteId)))
  if (variant.fileKey) await deleteShopFiles(event, [variant.fileKey])
  return { fileName: name, fileSize: file.data.byteLength }
}

export async function removeVariantFile(event: H3Event, variantId: string): Promise<void> {
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const variant = await db.query.productVariants.findFirst({ where: and(eq(productVariants.id, variantId), eq(productVariants.siteId, siteId)), columns: { fileKey: true } })
  if (!variant) notFound('That variant was not found.')
  await db.update(productVariants).set({ fileKey: null, fileName: null, fileSize: null, updatedAt: new Date().toISOString() })
    .where(and(eq(productVariants.id, variantId), eq(productVariants.siteId, siteId)))
  if (variant.fileKey) await deleteShopFiles(event, [variant.fileKey])
}

/** Best effort: a file left behind is only clutter in the bucket, removed with the site. */
export async function deleteShopFiles(event: H3Event, keys: string[]): Promise<void> {
  const siteId = requireSiteId(event)
  const { r2 } = getCfBindings(event)
  const own = keys.filter(k => k.startsWith(`_private/${siteId}/shop/`))
  if (!r2 || !own.length) return
  await r2.delete(own).catch(err => console.error('[shop] Deleting download files failed:', err))
}

// ── Signed links ────────────────────────────────────────────────────────────

function linkSecret(): string {
  const secret = useRuntimeConfig().betterAuthSecret as string | undefined
  if (!secret) throw new Error('betterAuthSecret is not configured')
  return secret
}

export function downloadToken(siteId: string, lineId: string): Promise<string> {
  return hmacSha256Hex(linkSecret(), `shop-download:${siteId}:${lineId}`)
}

export async function downloadLink(event: H3Event, siteId: string, lineId: string): Promise<string> {
  return `${bookingOrigin(event)}/_nuxflow/download/${lineId}?token=${await downloadToken(siteId, lineId)}`
}

export interface DownloadState {
  /** Downloads left on the link, and until when it works. */
  left: number
  expiresAt: string
  available: boolean
}

/** How a paid digital line's download stands, for the order page. */
export function downloadState(line: { downloads: number }, paidAt: string, limits: { downloadLimit: number; downloadDays: number }, now = new Date()): DownloadState {
  const expiresAt = new Date(Date.parse(paidAt) + limits.downloadDays * 86_400_000).toISOString()
  const left = Math.max(0, limits.downloadLimit - line.downloads)
  return { left, expiresAt, available: left > 0 && Date.parse(expiresAt) > now.getTime() }
}

/**
 * Serves one download: the token, a paid (and not fully refunded) order, the time limit and
 * the count are all checked, and the count goes up in the same statement that checks it,
 * so two clicks at once can't get past the limit.
 */
export async function serveDownload(event: H3Event, lineId: string, token: string): Promise<Response> {
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const valid = /^[0-9a-f]{64}$/.test(token) && constantTimeEqualHex(await downloadToken(siteId, lineId), token)
  if (!valid) notFound('This download link isn\'t valid.')

  const line = await db.query.orderLines.findFirst({ where: and(eq(orderLines.id, lineId), eq(orderLines.siteId, siteId)) })
  const order = line ? await db.query.orders.findFirst({ where: and(eq(orders.id, line.orderId), eq(orders.siteId, siteId)) }) : undefined
  if (!line || !order || line.kind !== 'product' || !line.isDigital || !line.refId) notFound('This download link isn\'t valid.')
  if ((order.status !== 'paid' && order.status !== 'partially_refunded') || !order.paidAt) {
    httpError({ status: 410, message: 'This order was refunded, so its download has stopped working.' })
  }

  const shop = await getShopSettings(event)
  const state = downloadState(line, order.paidAt, shop)
  if (Date.parse(state.expiresAt) <= Date.now()) httpError({ status: 410, message: 'This download link has expired. Contact the shop if you still need the file.' })

  const variant = await db.query.productVariants.findFirst({ where: and(eq(productVariants.id, line.refId), eq(productVariants.siteId, siteId)), columns: { fileKey: true } })
  const { r2 } = getCfBindings(event)
  const object = variant?.fileKey && r2 ? await r2.get(variant.fileKey) : null
  if (!object) httpError({ status: 404, message: 'The file for this download is missing. Contact the shop.' })

  const [counted] = await db.update(orderLines)
    .set({ downloads: sql`${orderLines.downloads} + 1` })
    .where(and(eq(orderLines.id, lineId), eq(orderLines.siteId, siteId), sql`${orderLines.downloads} < ${shop.downloadLimit}`))
    .returning({ downloads: orderLines.downloads })
  if (!counted) {
    await object.body.cancel().catch(() => null)
    httpError({ status: 410, message: 'This download link has been used as many times as it allows. Contact the shop if you still need the file.' })
  }

  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('Content-Length', String(object.size))
  headers.set('Cache-Control', 'private, no-store')
  headers.set('Content-Security-Policy', 'sandbox; default-src \'none\'')
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('X-Robots-Tag', 'noindex')
  if (!headers.has('Content-Disposition')) headers.set('Content-Disposition', 'attachment')
  return new Response(object.body, { status: 200, headers })
}
