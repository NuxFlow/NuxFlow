import type { AiProvider, AiCompletionOptions } from './index'

export class GeminiProvider implements AiProvider {
  readonly name = 'gemini'

  isConfigured(): boolean { return !!(process.env.GEMINI_API_KEY) }

  async complete(prompt: string, opts: AiCompletionOptions = {}): Promise<string> {
    const apiKey = process.env.GEMINI_API_KEY
    const model = 'gemini-1.5-flash'
    const contents = opts.systemPrompt
      ? [{ role: 'user', parts: [{ text: opts.systemPrompt + '\n\n' + prompt }] }]
      : [{ role: 'user', parts: [{ text: prompt }] }]

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents }) },
    )
    const json = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
    return json.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  }
}
