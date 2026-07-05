import { z } from 'zod'
import { generateText } from 'ai'
import { requireRole } from '../../../utils/permissions'
import { getAiSdkModel } from '../../../utils/ai-sdk'
import { useDb } from '../../../utils/db'
import { media } from '@nuxflow/db/schema'
import { and, eq, isNull, or } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'

const bodySchema = z.object({
  mediaIds: z.array(z.string()).optional(),
})

const SYSTEM = `You are an accessibility expert. Write concise, descriptive alt text for an image. Return ONLY the alt text string, no quotes, no explanation.`

export default defineEventHandler(async (event) => {
  await requireRole(event, 'editor')

  const model = await getAiSdkModel(event, 'fast')
  if (!model) throw createError({ statusCode: 503, message: 'No AI provider configured. Add an API key in Settings → AI.' })

  const { mediaIds } = await readValidatedBody(event, bodySchema.parse)
  const siteId = event.context.siteId as string
  const db = useDb(event)

  // If specific IDs provided, process those; otherwise process all images without alt text
  const whereClause: SQL = mediaIds?.length
    ? eq(media.siteId, siteId)
    : and(eq(media.siteId, siteId), or(isNull(media.altText), eq(media.altText, '')))!

  const targets = await db.query.media.findMany({
    where: whereClause,
    columns: { id: true, originalName: true, mimeType: true },
  })

  const imageTargets = targets.filter(f =>
    f.mimeType.startsWith('image/') && (!mediaIds?.length || mediaIds.includes(f.id)),
  )

  if (!imageTargets.length) {
    return { processed: 0, skipped: 0 }
  }

  let processed = 0
  let skipped = 0

  // Use waitUntil on Cloudflare so the response is sent immediately
  // while processing continues in the background
  const cfCtx = event.context.cloudflare?.ctx
  const run = async () => {
    for (const file of imageTargets) {
      try {
        const prompt = `Generate alt text for an image with filename: "${file.originalName}"`
        const { text } = await generateText({ model, system: SYSTEM, prompt, maxOutputTokens: 100 })
        await db.update(media)
          .set({ altText: text.trim() })
          .where(and(eq(media.id, file.id), eq(media.siteId, siteId)))
        processed++
      } catch {
        skipped++
      }
    }
  }

  if (cfCtx?.waitUntil) {
    cfCtx.waitUntil(run())
    return { processing: true, total: imageTargets.length }
  }

  // Fallback: run inline (local dev / non-CF environments)
  await run()
  return { processed, skipped, total: imageTargets.length }
})
