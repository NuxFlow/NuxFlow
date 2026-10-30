import { transcribe } from 'ai'
import { createWorkersAI } from 'workers-ai-provider'
import { requireRole } from '../../../utils/permissions'
import { callAiOrThrow } from '../../../utils/ai-sdk'
import { rateLimit } from '../../../utils/rate-limit'
import { getWorkersAiBinding } from '../../../utils/cf-env'
import { AI_CREDITS, assertAiAllowance, recordAiCall } from '../../../utils/ai-allowance'

const MAX_AUDIO_SIZE = 20 * 1024 * 1024

/**
 * Voice-to-text drafting — record yourself talking through a post idea, get a text draft
 * back to paste into the editor. Deliberately Workers-AI-only (not folded into the generic
 * `ai.provider` switch in ai-sdk.ts): transcription isn't part of the AI SDK's
 * text-generation surface (`generateText`/`generateObject`) that abstraction wraps, and
 * none of the five BYOK providers' SDKs already used here expose a transcription model —
 * adding real multi-provider transcription support would mean pulling in a 6th kind of SDK
 * call per provider for a comparatively minor feature. Returns 503 when the Workers AI
 * binding specifically isn't available, regardless of which text provider a site has
 * configured.
 */
export default defineEventHandler(async (event) => {
  await requireRole(event, 'editor')
  await rateLimit(event, { limit: 10, windowMs: 60_000, keyPrefix: 'ai-transcribe' })

  const ai = getWorkersAiBinding(event)
  if (!ai) {
    // Not requireAiSdkModel(): a site with its own OpenAI/Anthropic key would pass that
    // check (or be refused by the platform's AI allowance) and get the wrong message.
    throw httpError({ status: 503, message: 'Voice-to-text requires the Workers AI binding — see Settings → AI.' })
  }

  const contentLength = Number(getHeader(event, 'content-length') ?? 0)
  if (contentLength > MAX_AUDIO_SIZE) {
    throw httpError({ status: 413, message: 'Audio file too large (max 20 MB)' })
  }

  const formData = await readFormData(event)
  const file = formData.get('file') as File | null
  if (!file) throw badRequest('No audio file provided')
  if (file.size > MAX_AUDIO_SIZE) throw httpError({ status: 413, message: 'Audio file too large (max 20 MB)' })
  if (!file.type.startsWith('audio/')) {
    throw httpError({ status: 415, message: `Unsupported file type: ${file.type || 'unknown'}` })
  }

  const workersai = createWorkersAI({ binding: ai })
  const audio = new Uint8Array(await file.arrayBuffer())

  // No mediaType param exists on this AI SDK version's transcribe() — DataContent is just
  // string | Uint8Array | ArrayBuffer | Buffer, with no side channel for the source MIME
  // type. The SDK detects it internally from the audio bytes' own magic-byte signature.
  // Always Workers AI, so always platform-paid.
  await assertAiAllowance(event, AI_CREDITS.transcription)
  recordAiCall(event, 'platform', AI_CREDITS.transcription)
  const { text } = await callAiOrThrow(() =>
    transcribe({
      model: workersai.transcription('@cf/openai/whisper-large-v3-turbo'),
      audio,
    }),
  )

  return { text }
})
