import type { H3Event } from 'h3'
import { generateImage, type ImageModel } from 'ai'
import { resolveSetting } from '../settings'
import { getWorkersAiBinding } from '../cf-env'
import { gatewayBaseUrl, gatewayRequestHeaders, resolveGatewaySettings } from '../ai-sdk'

export type ImageShape = 'square' | 'landscape' | 'portrait'

export interface ImageGenerationOptions {
  shape?: ImageShape
  quality?: 'standard' | 'hd'
}

export interface ImageProvider {
  name: 'openai' | 'google' | 'workers-ai'
  /** Returns the image as a `data:` URL, whichever provider made it. */
  generate(prompt: string, options?: ImageGenerationOptions): Promise<string>
  isConfigured(): boolean
}

// Every provider goes through the AI SDK's generateImage(), like text generation goes
// through getAiSdkModel() — one call shape, bytes back from all three, and AI Gateway
// routing (caching, logs, per-user spend) applied the same way text already had it.
// This replaced a raw `openai` SDK call to DALL-E 3 (shut down by OpenAI on 2026-05-12)
// and a hand-built fetch to Imagen 3's :predict endpoint (shut down by Google on
// 2025-11-10) — both had been failing on every call. Re-check
// https://developers.openai.com/api/docs/deprecations and
// https://ai.google.dev/gemini-api/docs/deprecations before assuming these IDs stay valid.
const OPENAI_IMAGE_MODEL = 'gpt-image-1'
const GOOGLE_IMAGE_MODEL = 'gemini-3.1-flash-image'
// flux-1-schnell is Cloudflare's fast default; it has no quality setting, so `quality` is
// ignored for Workers AI.
const WORKERS_AI_IMAGE_MODEL = '@cf/black-forest-labs/flux-1-schnell'

const OPENAI_SIZES: Record<ImageShape, `${number}x${number}`> = { square: '1024x1024', landscape: '1536x1024', portrait: '1024x1536' }
const ASPECT_RATIOS: Record<ImageShape, `${number}:${number}`> = { square: '1:1', landscape: '16:9', portrait: '9:16' }
const WORKERS_AI_SIZES: Record<ImageShape, `${number}x${number}`> = { square: '1024x1024', landscape: '1024x576', portrait: '576x1024' }

/**
 * Converts raw image bytes to base64 without blowing the call stack — spreading a large
 * Uint8Array straight into String.fromCharCode(...arr) overflows once it reaches the
 * hundreds of KB a real image easily is.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK_SIZE = 8192
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE))
  }
  return btoa(binary)
}

class AiSdkImageProvider implements ImageProvider {
  constructor(
    readonly name: ImageProvider['name'],
    private readonly model: ImageModel,
    private readonly callOptions: (opts: ImageGenerationOptions) => Partial<Parameters<typeof generateImage>[0]>,
  ) {}

  isConfigured(): boolean {
    return true
  }

  async generate(prompt: string, opts: ImageGenerationOptions = {}): Promise<string> {
    const { images } = await generateImage({ model: this.model, prompt, ...this.callOptions(opts) })
    const image = images[0]
    if (!image?.uint8Array?.length) throw new Error(`${this.name} returned no image data`)
    return `data:${image.mediaType || 'image/png'};base64,${bytesToBase64(image.uint8Array)}`
  }
}

/**
 * Returns the best available image generation provider: OpenAI > Google > Workers AI. The
 * first two reuse whichever BYOK key is already configured for text generation; Workers AI
 * is the zero-setup fallback (only the binding), same reasoning as the ai.provider default
 * in ai-sdk.ts.
 */
export async function getImageProvider(event: H3Event, opts: { userId?: string } = {}): Promise<ImageProvider | null> {
  const { gatewayId, accountId, token } = await resolveGatewaySettings(event)
  const viaGateway = Boolean(gatewayId && accountId)

  const openaiKey = await resolveSetting(event, 'ai.openai_api_key', 'openaiApiKey') as string
  if (openaiKey) {
    const { createOpenAI } = await import('@ai-sdk/openai')
    const openai = createOpenAI({
      apiKey: openaiKey,
      ...(viaGateway && { baseURL: gatewayBaseUrl(accountId, gatewayId, 'openai'), headers: gatewayRequestHeaders(token, opts.userId) }),
    })
    return new AiSdkImageProvider('openai', openai.image(OPENAI_IMAGE_MODEL), o => ({
      size: OPENAI_SIZES[o.shape ?? 'square'],
      providerOptions: { openai: { quality: o.quality === 'hd' ? 'high' : 'medium' } },
    }))
  }

  const geminiKey = await resolveSetting(event, 'ai.gemini_api_key', 'geminiApiKey') as string
  if (geminiKey) {
    const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
    const google = createGoogleGenerativeAI({
      apiKey: geminiKey,
      ...(viaGateway && { baseURL: gatewayBaseUrl(accountId, gatewayId, 'google-ai-studio/v1beta'), headers: gatewayRequestHeaders(token, opts.userId) }),
    })
    return new AiSdkImageProvider('google', google.image(GOOGLE_IMAGE_MODEL), o => ({
      aspectRatio: ASPECT_RATIOS[o.shape ?? 'square'],
    }))
  }

  const ai = getWorkersAiBinding(event)
  if (ai) {
    const { createWorkersAI } = await import('workers-ai-provider')
    const workersai = createWorkersAI({
      binding: ai,
      ...(gatewayId && { gateway: { id: gatewayId, ...(opts.userId && { metadata: { userId: opts.userId } }) } }),
    })
    return new AiSdkImageProvider('workers-ai', workersai.image(WORKERS_AI_IMAGE_MODEL), o => ({
      size: WORKERS_AI_SIZES[o.shape ?? 'square'],
    }))
  }

  return null
}
