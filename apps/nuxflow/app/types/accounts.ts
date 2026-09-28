/** A site's branding on the accounts origin — GET /api/accounts/site (server/utils/accounts-sites.ts). */
export interface SiteBranding {
  id: string
  name: string
  domain: string
  origin: string
  logoUrl: string | null
  primaryColor: string | null
  allowRegistration: boolean
}
