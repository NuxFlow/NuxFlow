// Membership tier shapes the server sends and the app reads. Import-free, so the paywall,
// the account page, the Memberships block and the admin all use one definition.

/** How often a tier is paid for. `one_time` is a single payment (stored as `free_once_…`). */
export type TierInterval = 'month' | 'year' | 'one_time'

/**
 * A tier as the paywall and the account page get it: from `checkContentAccess()`
 * (server/utils/content-access.ts) and GET /api/v1/account/subscription.
 */
export interface TierSummary {
  id: string
  name: string
  price: number
  currency: string
  interval: TierInterval
  features: string[]
}

/** A tier as GET /api/public/memberships lists it (the Memberships block). */
export interface PublicTier extends TierSummary {
  description: string | null
  isActive?: boolean
}

/** A tier as Admin → Memberships edits it (GET /api/v1/memberships). */
export interface AdminTier extends PublicTier {
  isActive: boolean
  stripeProductId?: string | null
  stripePriceId?: string | null
  lsProductId?: string | null
  lsVariantId?: string | null
  paddleProductId?: string | null
  createdAt: string
}

const INTERVAL_LABELS: Record<TierInterval, string> = { month: 'mo', year: 'yr', one_time: 'once' }

/** The short label after a price: "£5 / mo", "£50 / yr", "£20 / once". */
export function tierIntervalLabel(interval: string): string {
  return INTERVAL_LABELS[interval as TierInterval] ?? interval
}
