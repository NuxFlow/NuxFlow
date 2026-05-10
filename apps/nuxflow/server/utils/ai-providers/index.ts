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

export function getAiProvider(): AiProvider | null {
  const config = useRuntimeConfig() as {
    aiProvider?: string
    openaiApiKey?: string
    anthropicApiKey?: string
    geminiApiKey?: string
    ollamaUrl?: string
  }
  const provider = config.aiProvider

  switch (provider) {
    case 'openai': return new OpenAiProvider()
    case 'anthropic': return new AnthropicProvider()
    case 'gemini': return new GeminiProvider()
    case 'ollama': return new OllamaProvider()
    default: return null
  }
}
