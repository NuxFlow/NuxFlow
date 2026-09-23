import { transcribe } from 'ai'
import { createWorkersAI } from 'workers-ai-provider'
import { requireRole } from '../../../utils/permissions'
import { requireAiSdkModel, callAiOrThrow } from '../../../utils/ai-sdk'
import { rateLimit } from '../../../utils/rate-limit'
import { getWorkersAiBinding } from '../../../utils/cf-env'

const MAX_AUDIO_SIZE = 20 * 1024 * 1024

/**
 * Voice-to-text drafting — record yourself talking through a post idea, get a text draft
 * back to paste into the editor. Deliberately Workers-AI-only (not folded into the generic
 * `ai.provider` switch in ai-sdk.ts): transcription isn't part of the AI SDK's
 * text-generation surface (`generateText`/`generateObject`) that abstraction wraps, and
 * none of the five BYOK providers' SDKs already used here expose a transcription model —
 * adding real multi-provider transcription support would mean pulling in a 6th kind of SDK
 * call per provider for a comparatively minor feature. Returns 503 (via requireAiSdkModel's
 * own check, reused here purely to get the standard "no provider" error copy) when the
 * Workers AI binding specifically isn't available, regardless of which text provider a site
 * has configured.
 */
export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  await rateLimit(event, { limit: 10, windowMs: 60_000, keyPrefix: 'ai-transcribe' })

  const ai = getWorkersAiBinding(event)
  if (!ai) {
    // Reuse requireAiSdkModel's standard 503 rather than hand-writing a second copy of the
    // same error — the underlying cause (no Workers AI binding) is the same class of
    // "AI provider unavailable" case every other AI route already surfaces this way.
    await requireAiSdkModel(event, 'fast', { userId })
    throw createError({ statusCode: 503, message: 'Voice-to-text requires the Workers AI binding — see Settings → AI.' })
  }

  const contentLength = Number(getHeader(event, 'content-length') ?? 0)
  if (contentLength > MAX_AUDIO_SIZE) {
    throw createError({ statusCode: 413, message: 'Audio file too large (max 20 MB)' })
  }

  const formData = await readFormData(event)
  const file = formData.get('file') as File | null
  if (!file) throw badRequest('No audio file provided')
  if (file.size > MAX_AUDIO_SIZE) throw createError({ statusCode: 413, message: 'Audio file too large (max 20 MB)' })
  if (!file.type.startsWith('audio/')) {
    throw createError({ statusCode: 415, message: `Unsupported file type: ${file.type || 'unknown'}` })
  }

  const workersai = createWorkersAI({ binding: ai })
  const audio = new Uint8Array(await file.arrayBuffer())

  // No mediaType param exists on this AI SDK version's transcribe() — DataContent is just
  // string | Uint8Array | ArrayBuffer | Buffer, with no side channel for the source MIME
  // type. The SDK detects it internally from the audio bytes' own magic-byte signature.
  const { text } = await callAiOrThrow(() =>
    transcribe({
      model: workersai.transcription('@cf/openai/whisper-large-v3-turbo'),
      audio,
    }),
  )

  return { text }
})
