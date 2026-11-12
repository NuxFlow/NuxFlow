// What Admin → Mailing list gets from the server: GET /api/v1/mailing-list (subscribers) and
// GET /api/v1/mailing-list/settings (the signup popup's settings). Import-free apart from
// other shared/lib types.
import type { SignupSettings } from './signup-prompt'

export type MailingListStatus = 'pending' | 'subscribed' | 'unsubscribed'

/** Someone on the site's mailing list (not a paying member: see membership-types.ts). */
export interface MailingListSubscriber {
  id: string
  email: string
  name: string | null
  status: MailingListStatus
  /** Where they signed up: `popup`, `block`, … */
  source: string
  sourcePath: string | null
  confirmSentAt: string | null
  confirmedAt: string | null
  unsubscribedAt: string | null
  /** Why the last Brevo sync failed. */
  syncError: string | null
  createdAt: string
}

export interface MailingListResponse {
  items: MailingListSubscriber[]
  total: number
  page: number
  perPage: number
  counts: Record<MailingListStatus, number>
  /** The site has a third-party email provider that can send list mail. */
  canSendListEmail: boolean
  /** The signup popup over the last `days` days. */
  stats: { days: number; shown: number; dismissed: number; signups: number }
}

export interface SignupSettingsResponse {
  settings: SignupSettings
  email: { provider: string; canSendListEmail: boolean; brevoKeyConfigured: boolean }
}
