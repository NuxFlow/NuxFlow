import { z } from 'zod'

// "Suggested by AI, approved by a person." Every AI feature that changes a site works the
// same way: the AI only proposes, the person sees the change (preview, list of changes)
// and applies it themselves. When they do, the write is recorded in the audit log with an
// `ai_assisted_*` action and what they asked for, so the site's history shows who decided
// and that AI was involved. Never set this for a change the person didn't see first.

export const aiAssistSchema = z.object({
  kind: z.string().trim().min(1).max(40),
  /** What the person asked for, in their words. */
  instruction: z.string().max(2000).default(''),
  /** The AI's own summary of what it changed, as shown to the person. */
  summary: z.string().max(2000).default(''),
})

export type AiAssist = z.infer<typeof aiAssistSchema>

/** The audit action for a write: `update` → `ai_assisted_update` when AI suggested it. */
export function auditAction(action: string, aiAssist: AiAssist | null | undefined): string {
  return aiAssist ? `ai_assisted_${action}` : action
}

/** The fields added to the audit row's `after` so the log can show what was asked. */
export function aiAuditDetails(aiAssist: AiAssist | null | undefined): { aiAssist?: AiAssist & { approvedAt: string } } {
  return aiAssist ? { aiAssist: { ...aiAssist, approvedAt: new Date().toISOString() } } : {}
}
