import { createWorkersAI } from 'workers-ai-provider'
import { generateSpeech } from 'ai'
import { useReplicaDb } from '../../../utils/db'
import { getWorkersAiBinding } from '../../../utils/cf-env'
import { extractPlainText } from '../../../utils/tiptap-text'
import { rateLimit } from '../../../utils/rate-limit'
import { contentItems } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

// Deepgram Aura-2 (like every TTS model) has a real per-request input-length ceiling — this
// also just keeps a single "Listen" click to a reasonable, fast-to-generate chunk rather
// than a full 5,000-word essay. Long-form articles get their first ~2 minutes of audio; a
// "continue reading" chunked-playback UI is a real follow-up, not implemented here.
const MAX_TEXT_LENGTH = 3000

/**
 * "Listen to this article" — generates spoken audio for a published page's body text via
 * Workers AI's text-to-speech model, on demand (not pre-generated/cached — a real follow-up
 * once usage patterns justify the extra complexity of a cache layer + invalidation-on-edit).
 * A separate top-level route rather than nested under public/pages/[slug]/ deliberately —
 * mixing a flat `pages/[slug].get.ts` with a `pages/[slug]/` folder is the exact pattern
 * CLAUDE.md documents as confusing Nitro's typed-route matching (see its "$fetch" /
 * "Historical typecheck bug" notes) — avoided entirely by using a distinct path segment.
 */
export default defineEventHandler(async (event) => {
  await rateLimit(event, { limit: 10, windowMs: 60_000, keyPrefix: 'listen' })

  const ai = getWorkersAiBinding(event)
  if (!ai) throw createError({ statusCode: 503, message: 'Text-to-speech requires the Workers AI binding.' })

  const siteId = event.context.siteId as string
  const slug = getRouterParam(event, 'slug')!

  const db = useReplicaDb(event)
  const item = await db.query.contentItems.findFirst({
    where: and(
      eq(contentItems.siteId, siteId),
      eq(contentItems.slug, slug),
      eq(contentItems.status, 'published'),
      eq(contentItems.visibility, 'public'),
    ),
    columns: { content: true },
  })
  if (!item) throw notFound('Content not found')

  // Canvas pages are a block layout, not prose — there's no single "article text" to read.
  const isCanvas = (item.content as { type?: string } | null)?.type === 'canvas'
  if (isCanvas) throw createError({ statusCode: 422, message: 'This page has no readable article text.' })

  const text = extractPlainText(item.content).slice(0, MAX_TEXT_LENGTH)
  if (!text) throw createError({ statusCode: 422, message: 'This page has no readable article text.' })

  const workersai = createWorkersAI({ binding: ai })
  const { audio } = await generateSpeech({
    model: workersai.speech('@cf/deepgram/aura-2-en'),
    text,
    voice: 'asteria',
  })

  setHeader(event, 'Content-Type', 'audio/mpeg')
  setHeader(event, 'Cache-Control', 'private, max-age=3600')
  return audio.uint8Array
})
