// What a site's admin screens get from the server: Settings → API keys and Audit log, the
// dashboard's setup checklist (server/utils/setup-checklist.ts) and plan usage card
// (sitePlanSummary(), server/utils/hosting-plans.ts). Import-free apart from other shared/lib types.
import type { PlanLimitKey } from './hosting-plan-limits'

// ── Settings → API keys and Audit log

/** An API key as listed (GET /api/v1/api-keys). The key itself is only shown once, when made. */
export interface ApiKeySummary {
  id: string
  name: string
  scopes: string[]
  lastUsedAt: string | null
  expiresAt: string | null
  createdAt: string
}

/** One audit log row (GET /api/v1/audit-log). */
export interface AuditLogEntry {
  id: string
  action: string
  resource: string
  resourceId: string | null
  /** Null once the user has been deleted. */
  userId: string | null
  createdAt: string
}

// ── Dashboard: setup checklist (GET /api/v1/site-checklist)

export type ChecklistStatus = 'done' | 'todo' | 'problem'
export type ChecklistTier = 'essential' | 'recommended'

export interface ChecklistItem {
  id: string
  tier: ChecklistTier
  status: ChecklistStatus
  title: string
  /** Plain-language explanation of the current state and why it matters. */
  detail: string
  /** Admin page where it's fixed. */
  fixUrl?: string
  fixLabel?: string
  /** Anchor in docs/installation.md with step-by-step instructions. */
  docsAnchor?: string
}

/** Everything but `disabled` is left out on the public demo, which shows no card. */
export interface SetupChecklistResponse {
  /** Only recommended items can be skipped. */
  items?: (ChecklistItem & { skipped: boolean })[]
  summary?: { essentialOpen: number; recommendedOpen: number; problems: number; total: number; done: number }
  /** The admin hid the card (honoured only while nothing essential is open or broken). */
  hidden?: boolean
  disabled?: true
}

// ── Dashboard: plan usage (GET /api/v1/site-plan)

/** One limit on the site's hosting plan and how much of it is used. */
export interface PlanLimitUsage {
  key: PlanLimitKey
  label: string
  /** Soft limits are only warned about, never enforced. */
  kind: 'hard' | 'soft'
  /** Counted per calendar month (UTC). */
  monthly: boolean
  unit: 'bytes' | 'count'
  used: number
  max: number
}

/** `plan: null` = the built-in unlimited plan: nothing to show. */
export interface SitePlanSummary {
  plan: { id: string; name: string; description: string } | null
  limits: PlanLimitUsage[]
}
