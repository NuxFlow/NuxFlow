import type { LanguageModel } from 'ai'
import type { H3Event } from 'h3'
import { resolveSetting } from './settings'

/**
 * Returns an AI SDK LanguageModel for the configured provider.
 * Returns null when the provider key is missing — callers throw 503 on null.
 * Each provider SDK is imported dynamically so a site configured for one
 * provider doesn't bundle the other four into the Worker.
 */
export async function getAiSdkModel(event: H3Event, quality: 'fast' | 'smart' = 'fast'): Promise<LanguageModel | null> {
  const provider = await resolveSetting(event, 'ai.provider', 'aiProvider') as string | undefined

  switch (provider) {
    case 'openai': {
      const apiKey = await resolveSetting(event, 'ai.openai_api_key', 'openaiApiKey') as string
      if (!apiKey) return null
      const { createOpenAI } = await import('@ai-sdk/openai')
      const openai = createOpenAI({ apiKey })
      return openai(quality === 'smart' ? 'gpt-4o' : 'gpt-4o-mini')
    }
    case 'anthropic': {
      const apiKey = await resolveSetting(event, 'ai.anthropic_api_key', 'anthropicApiKey') as string
      if (!apiKey) return null
      const { createAnthropic } = await import('@ai-sdk/anthropic')
      const anthropic = createAnthropic({ apiKey })
      return anthropic(quality === 'smart' ? 'claude-sonnet-5' : 'claude-haiku-4-5-20251001')
    }
    case 'gemini': {
      const apiKey = await resolveSetting(event, 'ai.gemini_api_key', 'geminiApiKey') as string
      if (!apiKey) return null
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
      const google = createGoogleGenerativeAI({ apiKey })
      // gemini-1.5-* was fully retired by Google — every request 404'd. gemini-2.5-* (the
      // direct replacement) is itself scheduled to shut down mid-October 2026, so this uses
      // the current generation instead. Given how fast Google is deprecating Gemini model
      // IDs (three generations retired inside a year), re-check
      // https://ai.google.dev/gemini-api/docs/models before assuming these stay valid.
      return google(quality === 'smart' ? 'gemini-3.1-pro' : 'gemini-3.8-flash')
    }
    case 'deepseek': {
      const apiKey = await resolveSetting(event, 'ai.deepseek_api_key', 'deepseekApiKey') as string
      if (!apiKey) return null
      const { createOpenAI } = await import('@ai-sdk/openai')
      const deepseek = createOpenAI({ apiKey, baseURL: 'https://api.deepseek.com/v1' })
      return deepseek('deepseek-chat')
    }
    case 'ollama': {
      const [url, model] = await Promise.all([
        resolveSetting(event, 'ai.ollama_base_url', 'ollamaUrl') as Promise<string>,
        resolveSetting(event, 'ai.ollama_model', 'ollamaModel') as Promise<string>,
      ])
      const { createOpenAI } = await import('@ai-sdk/openai')
      const ollama = createOpenAI({ apiKey: 'ollama', baseURL: `${url || 'http://localhost:11434'}/v1` })
      return ollama(model || 'llama3.2')
    }
    default:
      return null
  }
}

/** Same as getAiSdkModel, but throws the standard 503 instead of returning null. */
export async function requireAiSdkModel(event: H3Event, quality: 'fast' | 'smart' = 'fast'): Promise<LanguageModel> {
  const model = await getAiSdkModel(event, quality)
  if (!model) {
    throw createError({ statusCode: 503, message: 'No AI provider configured. Add an API key in Settings → AI.' })
  }
  return model
}

/** Runs an AI SDK call, throwing the standard 502 with a provider-friendly message on failure. */
export async function callAiOrThrow<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    throw createError({ statusCode: 502, message: aiErrorMessage(err) })
  }
}

/**
 * Fetches an already-uploaded media item's bytes so they can be passed to a multimodal
 * `generateText`/`generateObject` call as an image content part. `fetch()` in a Cloudflare
 * Worker only supports http(s) URLs — it can't fetch a `data:` URI, which is exactly what
 * the local media-provider fallback stores in `media.url` (see media-providers/index.ts) —
 * so a data URL is decoded directly instead of fetched.
 */
export async function loadImageBytesForAi(url: string, fallbackMediaType: string): Promise<{ data: Uint8Array; mediaType: string }> {
  if (url.startsWith('data:')) {
    const commaIndex = url.indexOf(',')
    if (commaIndex === -1) throw new Error('Malformed data URL')
    const header = url.slice(5, commaIndex)
    const isBase64 = header.endsWith(';base64')
    const mediaType = header.replace(/;base64$/, '') || fallbackMediaType
    const payload = url.slice(commaIndex + 1)
    const binary = isBase64 ? atob(payload) : decodeURIComponent(payload)
    const data = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i)
    return { data, mediaType }
  }

  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch image for AI processing (${res.status})`)
  const buf = await res.arrayBuffer()
  return { data: new Uint8Array(buf), mediaType: res.headers.get('content-type') || fallbackMediaType }
}

/** Extracts a human-readable message from a provider SDK error. */
export function aiErrorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    // AI SDK wraps errors with a message property
    if ('message' in err && typeof (err as { message: unknown }).message === 'string') {
      return (err as { message: string }).message
    }
    // Some provider SDKs expose a status code
    if ('status' in err) {
      const s = (err as { status: unknown }).status
      if (s === 401 || s === 403) return 'AI provider authentication failed — check your API key in Settings → AI'
      if (s === 429) return 'AI provider rate limit exceeded — try again in a moment'
      if (s === 404) return 'AI model not found — check your provider settings'
    }
  }
  return 'AI provider request failed'
}
