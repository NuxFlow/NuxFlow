import type { H3Event } from 'h3'
import { resolveSetting } from '../settings'
import { OpenAiProvider } from './openai'
import { AnthropicProvider } from './anthropic'
import { GeminiProvider } from './gemini'
import { OllamaProvider } from './ollama'

export interface AiCompletionOptions {
  temperature?: number
  maxTokens?: number
  systemPrompt?: string
}

export interface AiProvider {
  name: string
  complete(prompt: string, options?: AiCompletionOptions): Promise<string>
  isConfigured(): boolean
}

export async function getAiProvider(event: H3Event): Promise<AiProvider | null> {
  const provider = await resolveSetting(event, 'ai.provider', 'aiProvider') as string | undefined

  switch (provider) {
    case 'openai': {
      const apiKey = await resolveSetting(event, 'ai.openai_api_key', 'openaiApiKey')
      return new OpenAiProvider(apiKey)
    }
    case 'anthropic': {
      const apiKey = await resolveSetting(event, 'ai.anthropic_api_key', 'anthropicApiKey')
      return new AnthropicProvider(apiKey)
    }
    case 'gemini': {
      const apiKey = await resolveSetting(event, 'ai.gemini_api_key', 'geminiApiKey')
      return new GeminiProvider(apiKey)
    }
    case 'ollama': {
      const url = await resolveSetting(event, 'ai.ollama_base_url', 'ollamaUrl')
      const model = await resolveSetting(event, 'ai.ollama_model', 'ollamaModel')
      return new OllamaProvider(url, model)
    }
    default: return null
  }
}
