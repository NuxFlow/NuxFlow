import OpenAI from 'openai'
import type { AiProvider, AiCompletionOptions } from './index'

export class OpenAiProvider implements AiProvider {
  readonly name = 'openai'
  private client: OpenAI | null = null

  isConfigured(): boolean {
    return !!(process.env.OPENAI_API_KEY)
  }

  private getClient(): OpenAI {
    if (!this.client) {
      this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    }
    return this.client
  }

  async complete(prompt: string, opts: AiCompletionOptions = {}): Promise<string> {
    const client = this.getClient()
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = []
    if (opts.systemPrompt) messages.push({ role: 'system', content: opts.systemPrompt })
    messages.push({ role: 'user', content: prompt })

    const res = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens ?? 1000,
    })

    return res.choices[0]?.message?.content ?? ''
  }
}
