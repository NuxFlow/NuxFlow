// What the Generate with AI page (Admin → Content → Generate) gets from the server:
// jobResponse() in server/utils/site-generation.ts, which every /api/v1/ai/generate/** route
// returns, and the history list from GET /api/v1/ai/generate. Import-free.

export type GenerationJobType = 'page' | 'site'
export type GenerationJobStatus = 'planning' | 'approved' | 'generating' | 'complete' | 'failed'

/** The parts of a planned page the admin can edit before approving the plan. */
export interface GenerationPlanDraft {
  title: string
  slug: string
  description: string
}

/** One planned page, with its outcome once generated. Same shape as `AiGenerationPlanPage`
 * (the `ai_generation_jobs.plan` column), which the server is checked against. */
export interface GenerationPlanPage extends GenerationPlanDraft {
  contentItemId?: string
  error?: string
}

/** A generated draft that still exists, for the review screen's previews. `content` is the
 * page's stored content (Canvas blocks for a generated page). */
export interface GenerationJobItem {
  id: string
  title: string
  slug: string
  status: string
  content: unknown
}

export interface GenerationJob {
  id: string
  type: GenerationJobType
  status: GenerationJobStatus
  prompt: string
  tone: string | null
  plan: GenerationPlanPage[] | null
  generatedCount: number
  totalCount: number
  error: string | null
  /** Another request is working on this job right now. */
  busy: boolean
  items: GenerationJobItem[]
}

/** One row of the history list (GET /api/v1/ai/generate). */
export interface GenerationJobSummary {
  id: string
  prompt: string
  type: GenerationJobType
  status: GenerationJobStatus
  tone: string | null
  generatedCount: number
  totalCount: number
  createdAt: string
}
