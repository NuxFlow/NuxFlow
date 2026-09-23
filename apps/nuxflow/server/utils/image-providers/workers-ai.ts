import { generateImage } from 'ai'
import { createWorkersAI } from 'workers-ai-provider'
import type { ImageProvider, ImageGenerationOptions } from './index'

// Model IDs current as of the workers-ai-provider@4 README (Jul 2026) — see the same note
// on the text-generation model choice in ai-sdk.ts. flux-1-schnell is Cloudflare's
// documented "fast, free-tier image generation" default; there's no HD/quality toggle the
// way DALL-E has one, so ImageGenerationOptions.quality is accepted but ignored here,
// matching how ImagenProvider already ignores options it has no equivalent for.
const IMAGE_MODEL = '@cf/black-forest-labs/flux-1-schnell'

/**
 * Converts raw image bytes to a base64 string without blowing the call stack on a large
 * image — spreading a big Uint8Array directly into String.fromCharCode(...arr) risks
 * "Maximum call stack size exceeded" once the array gets into the hundreds of KB, which a
 * real generated image easily reaches.
 */
function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK_SIZE = 8192
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE))
  }
  return btoa(binary)
}

export class WorkersAiImageProvider implements ImageProvider {
  readonly name = 'workers-ai'
  private ai: Ai

  constructor(ai: Ai) {
    this.ai = ai
  }

  isConfigured(): boolean {
    return true
  }

  async generate(prompt: string, opts: ImageGenerationOptions = {}): Promise<string> {
    const workersai = createWorkersAI({ binding: this.ai })
    const { images } = await generateImage({
      model: workersai.image(IMAGE_MODEL),
      prompt,
      size: opts.size ?? '1024x1024',
    })

    const image = images[0]
    if (!image?.uint8Array) throw new Error('Workers AI returned no image data')

    // Data URL so downstream code (generate-image.post.ts) handles it identically to
    // ImagenProvider's output — no provider-specific branching needed at the call site.
    return `data:image/png;base64,${bytesToBase64(image.uint8Array)}`
  }
}
