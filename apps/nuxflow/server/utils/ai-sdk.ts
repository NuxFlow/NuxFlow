import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import type { LanguageModel } from 'ai'
import type { H3Event } from 'h3'
import { resolveSetting } from './settings'

/**
 * Returns an AI SDK LanguageModel for the configured provider.
 * Returns null when the provider key is missing — callers throw 503 on null.
 */
export async function getAiSdkModel(event: H3Event, quality: 'fast' | 'smart' = 'fast'): Promise<LanguageModel | null> {
  const provider = await resolveSetting(event, 'ai.provider', 'aiProvider') as string | undefined

  switch (provider) {
    case 'openai': {
      const apiKey = await resolveSetting(event, 'ai.openai_api_key', 'openaiApiKey') as string
      if (!apiKey) return null
      const openai = createOpenAI({ apiKey })
      return openai(quality === 'smart' ? 'gpt-4o' : 'gpt-4o-mini')
    }
    case 'anthropic': {
      const apiKey = await resolveSetting(event, 'ai.anthropic_api_key', 'anthropicApiKey') as string
      if (!apiKey) return null
      const anthropic = createAnthropic({ apiKey })
      return anthropic(quality === 'smart' ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001')
    }
    case 'gemini': {
      const apiKey = await resolveSetting(event, 'ai.gemini_api_key', 'geminiApiKey') as string
      if (!apiKey) return null
      const google = createGoogleGenerativeAI({ apiKey })
      return google(quality === 'smart' ? 'gemini-1.5-pro' : 'gemini-1.5-flash')
    }
    case 'deepseek': {
      const apiKey = await resolveSetting(event, 'ai.deepseek_api_key', 'deepseekApiKey') as string
      if (!apiKey) return null
      const deepseek = createOpenAI({ apiKey, baseURL: 'https://api.deepseek.com/v1' })
      return deepseek('deepseek-chat')
    }
    case 'ollama': {
      const [url, model] = await Promise.all([
        resolveSetting(event, 'ai.ollama_base_url', 'ollamaUrl') as Promise<string>,
        resolveSetting(event, 'ai.ollama_model', 'ollamaModel') as Promise<string>,
      ])
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
