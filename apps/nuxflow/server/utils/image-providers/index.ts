import type { H3Event } from 'h3'
import { resolveSetting } from '../settings'

export interface ImageGenerationOptions {
  size?: '1024x1024' | '1792x1024' | '1024x1792'
  quality?: 'standard' | 'hd'
}

export interface ImageProvider {
  name: string
  generate(prompt: string, options?: ImageGenerationOptions): Promise<string>
  isConfigured(): boolean
}

/**
 * Returns the best available image generation provider.
 * Priority: OpenAI (DALL-E 3) > Google (Imagen 3).
 * Uses the same API keys already configured for text generation.
 */
export async function getImageProvider(event: H3Event): Promise<ImageProvider | null> {
  const { DalleProvider } = await import('./dalle')
  const { ImagenProvider } = await import('./imagen')

  // Try OpenAI first
  const openaiKey = await resolveSetting(event, 'ai.openai_api_key', 'openaiApiKey') as string
  if (openaiKey) return new DalleProvider(openaiKey)

  // Fallback to Google Imagen
  const geminiKey = await resolveSetting(event, 'ai.gemini_api_key', 'geminiApiKey') as string
  if (geminiKey) return new ImagenProvider(geminiKey)

  return null
}
