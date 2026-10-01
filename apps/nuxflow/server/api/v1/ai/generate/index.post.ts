import { z } from 'zod'
import { ulid } from 'ulid'
import { requireRole } from '../../../../utils/permissions'
import { requireAiSdkModel } from '../../../../utils/ai-sdk'
import { rateLimit } from '../../../../utils/rate-limit'
import { useDb } from '../../../../utils/db'
import { TONES } from '../../../../utils/canvas-generation'
import { jobResponse } from '../../../../utils/site-generation'
import { aiGenerationJobs } from '@nuxflow/db/schema'
import { created } from '../../../../utils/response'
import { eq } from 'drizzle-orm'

const bodySchema = z.object({
  prompt: z.string().trim().min(10).max(2000),
  type: z.enum(['page', 'site']).default('site'),
  tone: z.enum(TONES).default('professional'),
})

/**
 * Creates a generation job — nothing is generated here. The admin page then drives the job
 * with POST .../:jobId/step (see site-generation.ts for why work isn't run in the
 * background). A 'site' job starts in 'planning' and waits for the plan to be approved; a
 * 'page' job has a single implicit plan entry and goes straight to 'generating'.
 */
export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  await rateLimit(event, { limit: 5, windowMs: 60_000, keyPrefix: 'ai-generate' })
  // Fails fast with the standard 503 before a job row exists if no provider is configured.
  await requireAiSdkModel(event, 'smart', { userId })

  const { prompt, type, tone } = await parseBody(event, bodySchema)
  const siteId = event.context.siteId as string
  const db = useDb(event)

  const id = ulid()
  await db.insert(aiGenerationJobs).values({
    id,
    siteId,
    userId,
    prompt,
    type,
    tone,
    ...(type === 'site'
      ? { status: 'planning' as const }
      : { status: 'generating' as const, plan: [{ title: '', slug: '', description: prompt }], totalCount: 1 }),
  })

  const job = await db.query.aiGenerationJobs.findFirst({ where: eq(aiGenerationJobs.id, id) })
  return created(event, { jobId: id, job: await jobResponse(db, job!) })
})
