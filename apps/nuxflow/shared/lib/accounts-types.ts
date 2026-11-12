// What a person's own account pages get from the server. Import-free.
//
// On the accounts origin (central sign-in, server/utils/accounts-sites.ts): a site's
// branding, the person's sites, and the /authorize page. On a site's own /account page:
// their notification preferences and post-by-email address.

// ── Accounts origin

/** A site's branding on the accounts origin (GET /api/accounts/site). Data only: never the
 * site's CSS, theme or custom code, which is the whole point of signing in somewhere else. */
export interface SiteBranding {
  id: string
  name: string
  domain: string
  origin: string
  logoUrl: string | null
  primaryColor: string | null
  allowRegistration: boolean
}

/** One of the signed-in person's sites (GET /api/accounts/sites, "Your sites"). Also what a
 * member pool sends back for its own sites. */
export interface AccountSiteListing {
  id: string
  name: string
  domain: string
  role: string
  origin: string
}

/** GET /api/accounts/authorize: who is signing in to which site. */
export interface AuthorizeInfo {
  site: SiteBranding
  /** Null when nobody is signed in on the accounts origin yet. */
  user: { name: string; email: string; image: string | null } | null
  /** Has a role on the site already, so continues without the "Continue to …?" step. */
  isMember: boolean
}

// ── A person's account on a site

/** One notification type and how they get it (GET /api/v1/account/notification-preferences). */
export interface NotificationPreference {
  type: string
  label: string
  description: string
  email: boolean
  push: boolean
  /** Security notices are always emailed. */
  emailLocked: boolean
}

export interface NotificationPreferencesResponse {
  preferences: NotificationPreference[]
}

/** GET /api/v1/account/post-address: their secret address for posting by email. */
export interface PostAddressInfo {
  /** Null until they create one. `platformAddress` is the shared-domain form, when there is one. */
  address: { siteAddress: string; platformAddress: string | null } | null
  /** Mail must come from this address (their account's) to be accepted. */
  senderEmail: string | null
  enabled?: boolean
  createdAt?: string
}
