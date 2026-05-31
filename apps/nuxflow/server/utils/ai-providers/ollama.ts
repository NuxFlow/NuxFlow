import type { AiProvider, AiCompletionOptions } from './index'

export class OllamaProvider implements AiProvider {
  readonly name = 'ollama'
  private customUrl?: string
  private customModel?: string

  constructor(customUrl?: string, customModel?: string) {
    this.customUrl = customUrl
    this.customModel = customModel
  }

  private get baseUrl() { return this.customUrl || process.env.OLLAMA_URL || 'http://localhost:11434' }
  private get model() { return this.customModel || process.env.OLLAMA_MODEL || 'llama3.2' }

  isConfigured(): boolean { return !!(this.baseUrl || this.model) }

  async complete(prompt: string, opts: AiCompletionOptions = {}): Promise<string> {
    const fullPrompt = opts.systemPrompt ? `${opts.systemPrompt}\n\n${prompt}` : prompt

    const res = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt: fullPrompt, stream: false }),
    })
    const json = await res.json() as { response?: string }
    return json.response ?? ''
  }
}
