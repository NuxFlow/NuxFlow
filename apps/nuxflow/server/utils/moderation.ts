import { z } from 'zod'
import { generateObject } from 'ai'
import type { H3Event } from 'h3'
import { getAiSdkModel, callAiOrThrow } from './ai-sdk'

const moderationSchema = z.object({
  flagged: z.boolean(),
  reason: z.string().max(200),
})

const SYSTEM = `You are a spam and abuse filter for a website's public comments and form submissions. Flag content that is spam (unsolicited advertising, scams, link farms), abusive/harassing, or contains malicious content. Do NOT flag genuine feedback, questions, or criticism just because it's negative — only flag actual spam or abuse.`

/**
 * Best-effort AI moderation check for guest-submitted text (comments, form submissions) —
 * a supplementary content-based filter layered on top of Turnstile's bot check, catching
 * spam/abuse that's submitted by a real human/browser (so it passes Turnstile) but is still
 * bad content. Returns null when no AI provider is configured, or on any failure — this is
 * always a best-effort background pass (call via waitUntil AFTER the row is already
 * inserted and the response already sent), never a submission-blocking gate. A false
 * negative here just means normal manual moderation still applies, same as before this
 * existed; a thrown error must never turn into a lost/rejected legitimate submission.
 */
export async function moderateText(event: H3Event, text: string): Promise<{ flagged: boolean; reason: string } | null> {
  if (!text.trim()) return null
  try {
    const model = await getAiSdkModel(event, 'fast')
    if (!model) return null
    const { object } = await callAiOrThrow(() =>
      generateObject({ model, schema: moderationSchema, system: SYSTEM, prompt: text.slice(0, 4000), maxOutputTokens: 150 }),
    )
    return object
  } catch (err) {
    console.error('[moderation] AI moderation check failed:', err)
    return null
  }
}
