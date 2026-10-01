import { z } from 'zod'
import { generateText } from 'ai'
import { requireRole } from '../../../utils/permissions'
import { requireAiSdkModel, loadImageBytesForAi } from '../../../utils/ai-sdk'
import { rateLimit } from '../../../utils/rate-limit'
import { useDb } from '../../../utils/db'
import { writeAuditLog } from '../../../utils/audit'
import { media } from '@nuxflow/db/schema'
import { and, eq, inArray, isNull, like, notInArray, or } from 'drizzle-orm'

const bodySchema = z.object({
  // Specific images to (re)generate alt text for; omitted = images that have none yet.
  mediaIds: z.array(z.string()).max(200).optional(),
  // Images that already failed earlier in this run — skipped so a persistently failing
  // image can't be picked again on every batch and stall the run.
  skipIds: z.array(z.string()).max(1000).optional(),
})

const SYSTEM = `You are an accessibility expert. Write concise, descriptive alt text for an image. Return ONLY the alt text string, no quotes, no explanation.`

// Images handled per request. The work runs inline while the admin page waits — not in
// waitUntil(), whose 30-second budget after the response a batch of vision calls can't
// fit (https://developers.cloudflare.com/workers/runtime-apis/context/) and which used to
// get silently cancelled part-way. The media page calls this in a loop while `hasMore`, showing progress as it goes.
const BATCH_SIZE = 5

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  // One batch per call, looped by the client: generous enough for a large library, still a
  // ceiling on how fast a runaway loop can spend AI credit.
  await rateLimit(event, { limit: 30, windowMs: 60_000, keyPrefix: 'ai-bulk-alt-text' })

  const model = await requireAiSdkModel(event, 'vision', { userId })

  const { mediaIds, skipIds } = await parseBody(event, bodySchema)
  const siteId = event.context.siteId as string
  const db = useDb(event)

  const where = and(
    eq(media.siteId, siteId),
    like(media.mimeType, 'image/%'),
    mediaIds?.length ? inArray(media.id, mediaIds) : or(isNull(media.altText), eq(media.altText, '')),
    skipIds?.length ? notInArray(media.id, skipIds) : undefined,
  )

  const candidates = await db.query.media.findMany({
    where,
    columns: { id: true, originalName: true, mimeType: true, url: true },
    limit: mediaIds?.length ? mediaIds.length : BATCH_SIZE + 1,
  })
  const batch = candidates.slice(0, BATCH_SIZE)

  const updated: Array<{ id: string; altText: string }> = []
  const failed: string[] = []

  for (const file of batch) {
    try {
      // The model needs the actual image — see alt-text.post.ts.
      const { data, mediaType } = await loadImageBytesForAi(event, file.url, file.mimeType)
      const { text } = await generateText({
        model,
        system: SYSTEM,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: `Generate alt text for this image (filename: "${file.originalName}").` },
            { type: 'image', image: data, mediaType },
          ],
        }],
        maxOutputTokens: 100,
      })
      const altText = text.trim()
      await db.update(media).set({ altText }).where(and(eq(media.id, file.id), eq(media.siteId, siteId)))
      updated.push({ id: file.id, altText })
    }
    catch (err) {
      // Logged so a systemic problem (bad key, provider outage) is diagnosable rather than
      // showing up only as a failure count in the admin UI.
      console.error(`[bulk-alt-text] Failed to generate alt text for media ${file.id} ("${file.originalName}")`, err)
      failed.push(file.id)
    }
  }

  if (batch.length) {
    // One audit row per batch rather than per image.
    await writeAuditLog(event, userId, {
      action: 'update',
      resource: 'media',
      resourceId: 'bulk-alt-text',
      after: { siteId, processed: updated.length, skipped: failed.length, total: batch.length },
    })
  }

  // For an explicit id list the caller sends the rest next time; otherwise the extra row
  // fetched above (BATCH_SIZE + 1) says whether more untagged images are waiting.
  const hasMore = candidates.length > batch.length

  return {
    processed: updated.length,
    skipped: failed.length,
    updated,
    failed,
    hasMore,
  }
})
