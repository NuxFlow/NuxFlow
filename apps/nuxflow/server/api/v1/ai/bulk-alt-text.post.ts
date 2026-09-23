import { z } from 'zod'
import { generateText } from 'ai'
import { requireRole } from '../../../utils/permissions'
import { requireAiSdkModel, loadImageBytesForAi } from '../../../utils/ai-sdk'
import { rateLimit } from '../../../utils/rate-limit'
import { useDb } from '../../../utils/db'
import { waitUntil } from '../../../utils/cf-env'
import { writeAuditLog } from '../../../utils/audit'
import { media } from '@nuxflow/db/schema'
import { and, eq, isNull, or } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'

const bodySchema = z.object({
  mediaIds: z.array(z.string()).optional(),
})

const SYSTEM = `You are an accessibility expert. Write concise, descriptive alt text for an image. Return ONLY the alt text string, no quotes, no explanation.`

// Caps how many images a single invocation processes. Each image costs at least one
// outbound fetch to the configured AI provider (generateText) plus one D1 write — both
// count as subrequests against the Workers Paid plan's documented 1,000-subrequests-per-
// invocation ceiling (https://developers.cloudflare.com/workers/platform/limits/ — NuxFlow
// requires the Paid plan regardless, see CLAUDE.md). At 2 subrequests/image worst case, 50
// stays two orders of magnitude under that ceiling with plenty of room for everything else
// this request does, and keeps one invocation's AI-provider call volume well clear of most
// providers' own per-minute rate limits too. It also matches the order of magnitude other
// deliberately-bounded (not fully paginated) routes in this codebase already use — see
// `MAX_REVISIONS_RETURNED = 50` in `content/[id]/revisions.get.ts`. When more images match
// than the cap, the response reports `capped`/`remaining` so the caller can invoke again
// for the rest (see the admin media page's bulk alt-text handler).
const MAX_IMAGES_PER_RUN = 50

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  // This single call can fan out into up to MAX_IMAGES_PER_RUN provider calls, so its
  // per-minute call limit is set lower than the single-image AI routes (alt-text.post.ts
  // uses 15/min) even though each individual invocation is comparatively cheap.
  await rateLimit(event, { limit: 5, windowMs: 60_000, keyPrefix: 'ai-bulk-alt-text' })

  const model = await requireAiSdkModel(event, 'vision', { userId })

  const { mediaIds } = await parseBody(event, bodySchema)
  const siteId = event.context.siteId as string
  const db = useDb(event)

  // If specific IDs provided, process those; otherwise process all images without alt text
  const whereClause: SQL = mediaIds?.length
    ? eq(media.siteId, siteId)
    : and(eq(media.siteId, siteId), or(isNull(media.altText), eq(media.altText, '')))!

  const targets = await db.query.media.findMany({
    where: whereClause,
    columns: { id: true, originalName: true, mimeType: true, url: true },
  })

  const matchingImages = targets.filter(f =>
    f.mimeType.startsWith('image/') && (!mediaIds?.length || mediaIds.includes(f.id)),
  )

  if (!matchingImages.length) {
    return { processed: 0, skipped: 0, total: 0 }
  }

  const imageTargets = matchingImages.slice(0, MAX_IMAGES_PER_RUN)
  const remaining = matchingImages.length - imageTargets.length
  const targetIds = imageTargets.map(f => f.id)

  // Processes in the background via the shared waitUntil() helper (cf-env.ts) so the HTTP
  // response returns immediately instead of holding the request open for however long up
  // to MAX_IMAGES_PER_RUN sequential AI provider calls take.
  const run = async () => {
    let processed = 0
    let skipped = 0

    for (const file of imageTargets) {
      try {
        // See alt-text.post.ts's single-image route for why the model needs the actual
        // image bytes, not just the filename.
        const { data, mediaType } = await loadImageBytesForAi(file.url, file.mimeType)
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
        await db.update(media)
          .set({ altText: text.trim() })
          .where(and(eq(media.id, file.id), eq(media.siteId, siteId)))
        processed++
      } catch (err) {
        // Log the real failure so a systemic problem (expired/invalid API key, provider
        // outage, rate limiting) is diagnosable from Worker logs instead of showing up only
        // as an unexplained "0 processed" in the admin UI.
        console.error(`[bulk-alt-text] Failed to generate alt text for media ${file.id} ("${file.originalName}")`, err)
        skipped++
      }
    }

    // One audit log row for the whole batch rather than one per image — this can touch
    // dozens of media rows per invocation, and a per-image audit row would just be a second
    // N+1/write-amplification problem stacked on top of the one MAX_IMAGES_PER_RUN already
    // addresses on the AI-provider side.
    await writeAuditLog(event, userId, {
      action: 'update',
      resource: 'media',
      resourceId: 'bulk-alt-text',
      after: { siteId, processed, skipped, total: imageTargets.length },
    })
  }

  waitUntil(event, run())

  return {
    processing: true,
    total: imageTargets.length,
    mediaIds: targetIds,
    capped: remaining > 0,
    remaining,
  }
})
