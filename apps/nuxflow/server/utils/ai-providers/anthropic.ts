import Anthropic from '@anthropic-ai/sdk'
import type { AiProvider, AiCompletionOptions } from './index'

export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic'
  private client: Anthropic | null = null
  private apiKey?: string

  constructor(apiKey?: string) {
    this.apiKey = apiKey
  }

  isConfigured(): boolean {
    return !!(this.apiKey || process.env.ANTHROPIC_API_KEY)
  }

  private getClient(): Anthropic {
    if (!this.client) {
      this.client = new Anthropic({ apiKey: this.apiKey || process.env.ANTHROPIC_API_KEY })
    }
    return this.client
  }

  async complete(prompt: string, opts: AiCompletionOptions = {}): Promise<string> {
    const client = this.getClient()
    const res = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: opts.maxTokens ?? 1000,
      system: opts.systemPrompt,
      messages: [{ role: 'user', content: prompt }],
    })

    const block = res.content[0]
    return block?.type === 'text' ? block.text : ''
  }
}
