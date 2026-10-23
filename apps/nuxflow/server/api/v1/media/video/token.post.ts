import { requireRole } from '../../../../utils/permissions'
import { parseBody } from '../../../../utils/validate'
import { z } from 'zod'
import { requireSiteId } from '../../../../utils/site-context'
import { useDb } from '../../../../utils/db'
import { checkPlanLimit, planLimitMessage } from '../../../../utils/hosting-plans'
import { forbidden } from '../../../../utils/response'
import { createStreamUpload, MAX_UPLOAD_DURATION_SECONDS, streamNotConfigured, uploadStreamAccount } from '../../../../utils/stream'
import { videoAssets } from '@nuxflow/db/schema'
import { ulid } from 'ulid'
import { buildAuditLogInsert, batchWithAudit } from '../../../../utils/audit'

// Stream's own per-file cap for resumable uploads.
const MAX_UPLOAD_BYTES = 30 * 1024 ** 3

const bodySchema = z.object({
  title: z.string().trim().max(500).optional(),
  size: z.number().int().positive().max(MAX_UPLOAD_BYTES, 'Videos can be up to 30 GB'),
})

// Starts a resumable (tus) upload: returns the upload.cloudflarestream.com URL the browser
// sends the file to in chunks (useVideoUpload.ts). The browser never sees the Stream token.
// The library row is written now, as 'uploading', so a video whose tab was closed before
// it was registered is still listed, counted against the plan and deleted with the site —
// never left in the Stream account (and on its bill) with nothing pointing at it.
export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'author')
  const siteId = requireSiteId(event)
  const body = await parseBody(event, bodySchema)

  const account = await uploadStreamAccount(event)
  if (!account) streamNotConfigured()

  // Video in the operator's Stream account is billed per minute stored, so it comes out of
  // the plan's video minutes. Stream itself stops an upload longer than what's left.
  let maxDurationSeconds = MAX_UPLOAD_DURATION_SECONDS
  if (account.kind === 'platform') {
    const check = await checkPlanLimit(useDb(event), siteId, 'video', 1)
    if (!check.allowed) {
      throw forbidden(planLimitMessage('video', check.max ?? 0), { code: 'plan_limit', limit: 'video', used: check.used, max: check.max })
    }
    if (check.max !== null) maxDurationSeconds = Math.min(maxDurationSeconds, (check.max - check.used) * 60)
  }

  const title = (body.title || 'Untitled Video').replace(/\.[^/.]+$/, '') || 'Untitled Video'
  const { uploadUrl, uid } = await createStreamUpload(account, { size: body.size, name: title, maxDurationSeconds, creator: siteId })

  const db = useDb(event)
  const id = ulid()
  const insert = db.insert(videoAssets).values({
    id,
    siteId,
    uploadedBy: userId,
    cloudflareStreamId: uid,
    title,
    status: 'uploading',
    size: body.size,
    streamAccount: account.kind,
  })
  const audit = buildAuditLogInsert(event, userId, {
    action: 'create',
    resource: 'video_assets',
    resourceId: id,
    after: { title, cloudflareStreamId: uid, streamAccount: account.kind },
  })
  await batchWithAudit(db, [insert], audit)

  return { id, uid, uploadUrl }
})
