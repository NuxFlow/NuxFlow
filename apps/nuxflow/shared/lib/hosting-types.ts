// What a hosting customer sees on the accounts origin (My hosting, signing up for a site,
// their own domains): /api/accounts/hosting/** (server/utils/hosting-billing.ts,
// hosting-domains.ts). Import-free.

/** A plan on sale (listPublicPlans()). A price is null when it can't be bought that way. */
export interface PublicHostingPlan {
  id: string
  name: string
  description: string
  /** The operator's own wording for the price, shown instead when set. */
  priceText: string
  currency: string
  priceMonthly: number | null
  priceYearly: number | null
  trialDays: number
  /** Null = unlimited. */
  limits: {
    maxStorageBytes: number | null
    maxContentItems: number | null
    maxTeamMembers: number | null
    maxAiCallsPerMonth: number | null
    maxEmailsPerMonth: number | null
    maxPlugins: number | null
    maxCustomDomains: number | null
  }
}

/** GET /api/accounts/hosting: is hosting sign-up offered here, and what's for sale. */
export interface HostingSignupInfo {
  enabled: boolean
  /** False while the operator has paused new sign-ups (no plans are listed then). */
  signupsOpen: boolean
  /** Where customer sites get their address, e.g. `nuxflow.site`. */
  sitesDomain: string | null
  plans: PublicHostingPlan[]
}

/** GET /api/accounts/hosting/subdomain: is this address free? */
export interface SubdomainCheck {
  available: boolean
  domain: string
  /** Why not, in words for the customer. */
  reason?: string
}

/** One sign-up on My hosting (listCustomerHosting()), newest first. */
export interface CustomerHostedSite {
  id: string
  /** Stripe's subscription status, or `checkout` before payment. */
  status: string
  interval: 'month' | 'year'
  plan: { id: string; name: string } | null
  /** Null until the site has been created. */
  site: { id: string; name: string; domain: string; status: string } | null
  requestedSiteName: string
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  pastDueSince: string | null
  /** Put into maintenance for non-payment (reopens by itself once paid). */
  paused: boolean
}

export interface CustomerHostingResponse {
  subscriptions: CustomerHostedSite[]
}

/** One of a site's addresses: the main one first, then the others. */
export interface CustomerDomain {
  hostname: string
  /** `custom` = the customer's own domain; `platform` = the address the site started with. */
  kind: 'custom' | 'platform'
  main: boolean
  live: boolean
  status: string
  sslStatus: string | null
  errors: string[]
}

/** The domains panel (domainPanel(), every /api/accounts/hosting/domains route). */
export interface CustomerDomainPanel {
  /** Own domains are set up on this platform. */
  available: boolean
  /** Where the customer points their CNAME. */
  target: string
  /** How many own domains the plan allows (null = no limit). */
  allowed: number | null
  used: number
  domains: CustomerDomain[]
}
