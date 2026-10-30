import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { videoAssets } from '@nuxflow/db/schema'
import { ulid } from 'ulid'
import { buildAuditLogInsert, batchWithAudit } from '../../../../utils/audit'
import { created, forbidden, httpError } from '../../../../utils/response'
import { parseBody } from '../../../../utils/validate'
import { z } from 'zod'
import { requireSiteId } from '../../../../utils/site-context'
import { and, eq } from 'drizzle-orm'
import { getStreamVideo, STREAM_ID_RE, streamAccountFor, streamNotConfigured, uploadStreamAccount, type StreamVideoDetails } from '../../../../utils/stream'

const bodySchema = z.object({
  // Cloudflare Stream video UIDs are 32 hex characters; anything else is never a real
  // upload, and the value is interpolated into a Cloudflare API URL below.
  uid: z.string().regex(STREAM_ID_RE, 'Invalid video UID').transform(v => v.toLowerCase()),
  title: z.string().trim().max(500).optional(),
  size: z.number().int().nonnegative().optional(),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'author')
  const siteId = requireSiteId(event)

  const body = await parseBody(event, bodySchema)
  const uid = body.uid
  let title = body.title
  const size = body.size

  // The browser calls this once its upload has finished. token.post.ts already wrote the
  // row: bring it up to date with Stream (still processing, or ready).
  const db = useDb(event)
  const existing = await db.query.videoAssets.findFirst({
    where: and(eq(videoAssets.siteId, siteId), eq(videoAssets.cloudflareStreamId, uid)),
  })
  if (existing) {
    const existingAccount = await streamAccountFor(event, existing.streamAccount)
    if (!existingAccount) streamNotConfigured()
    const details = await getStreamVideo(existingAccount, uid)
    const status = details ? statusOf(details) : 'failed'
    const update = {
      status,
      duration: details?.duration && details.duration > 0 ? Math.round(details.duration) : existing.duration,
      thumbnailUrl: details?.thumbnail || existing.thumbnailUrl,
      ...(title && { title }),
    }
    await db.update(videoAssets).set(update).where(and(eq(videoAssets.id, existing.id), eq(videoAssets.siteId, siteId)))
    return created(event, { id: existing.id, title: update.title ?? existing.title, cloudflareStreamId: uid, status })
  }

  // Uploads started before token.post.ts wrote the row: the same account it uploaded into.
  const account = await uploadStreamAccount(event)
  if (!account) streamNotConfigured()

  // The `uid` is client-supplied and never verified against what token.post.ts actually
  // issued, so this lookup must succeed before anything is inserted. Any failure (bad uid,
  // network error, non-2xx) fails the request: a row inserted anyway would sit at
  // status:'processing' until the stuck-video sweep marks it failed.
  const res = await getStreamVideo(account, uid)
  if (!res) {
    throw httpError({
      status: 404,
      message: 'Cloudflare Stream did not recognize this upload UID. It may not have finished uploading yet, or belongs to a different account.',
    })
  }

  // token.post.ts sets the upload's creator to the site that asked for it (older direct
  // uploads stamped meta.siteId instead) — the `uid` itself is client-supplied with no other
  // proof of which site's upload flow it came from. The platform's Stream account is shared
  // by every hosted customer, so any author could otherwise register another site's video
  // by guessing or leaking its uid. Anything not stamped with this site is refused.
  if (res.creator !== siteId && res.meta?.siteId !== siteId) {
    throw forbidden('This upload does not belong to the current site.')
  }
  if (!title && res.meta?.name) title = res.meta.name
  const duration = res.duration && res.duration > 0 ? Math.round(res.duration) : null
  const thumbnailUrl = res.thumbnail || null

  const status = statusOf(res)

  const finalTitle = title || 'Untitled Video'
  const fileId = ulid()

  const assetInsert = db.insert(videoAssets).values({
    id: fileId,
    siteId,
    uploadedBy: userId,
    cloudflareStreamId: uid,
    title: finalTitle,
    duration,
    thumbnailUrl,
    status,
    size: size || null,
    isPrivate: res.requireSignedURLs === true,
    streamAccount: account.kind,
  })

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'create',
    resource: 'video_assets',
    resourceId: fileId,
    after: { title: finalTitle, cloudflareStreamId: uid, streamAccount: account.kind },
  })
  await batchWithAudit(db, [assetInsert], auditInsert)

  return created(event, {
    id: fileId,
    title: finalTitle,
    cloudflareStreamId: uid,
    status,
  })
})

function statusOf(details: StreamVideoDetails): 'processing' | 'ready' | 'failed' {
  const state = details.status?.state
  return state === 'ready' ? 'ready' : state === 'error' ? 'failed' : 'processing'
}
