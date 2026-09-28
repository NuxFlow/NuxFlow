import type { H3Event } from 'h3'
import { and, eq, inArray } from 'drizzle-orm'
import { siteSettings, sites, userSiteRoles } from '@nuxflow/db/schema'
import { useDb } from './db'
import { getSiteInfo } from './site-info'
import { siteOriginForDomain } from './site-auth'
import { absoluteUrl } from './media-url'

export interface SiteBranding {
  id: string
  name: string
  domain: string
  origin: string
  logoUrl: string | null
  primaryColor: string | null
  allowRegistration: boolean
}

const HEX_COLOR = /^#[0-9a-f]{3,8}$/i

/**
 * What the accounts origin shows about a site ("Sign in to Acme Bakery", its logo and
 * colour). Data only — never the site's CSS, theme, or custom code, which is the whole
 * point of signing in somewhere else. Null for an unknown or suspended site.
 */
export async function getSiteBranding(event: H3Event, siteId: string): Promise<SiteBranding | null> {
  const site = await getSiteInfo(event, siteId)
  if (!site || site.status === 'suspended') return null
  const rows = await useDb(event).query.siteSettings.findMany({
    where: and(eq(siteSettings.siteId, siteId), inArray(siteSettings.key, ['appearance.logo_url', 'theme.primary_color', 'auth.allow_public_registration'])),
    columns: { key: true, value: true },
  })
  const map = Object.fromEntries(rows.map(r => [r.key, r.value])) as Record<string, unknown>
  const origin = siteOriginForDomain(site.domain)

  const rawLogo = typeof map['appearance.logo_url'] === 'string' ? absoluteUrl(map['appearance.logo_url'], origin) : null
  const logoUrl = rawLogo && /^https?:\/\//i.test(rawLogo) ? rawLogo : null
  const color = typeof map['theme.primary_color'] === 'string' ? map['theme.primary_color'].trim() : ''

  return {
    id: site.id,
    name: site.name,
    domain: site.domain,
    origin,
    logoUrl,
    primaryColor: HEX_COLOR.test(color) ? color : null,
    allowRegistration: map['auth.allow_public_registration'] === 'true' || map['auth.allow_public_registration'] === true,
  }
}

/** The sites a user belongs to, for the accounts home page. */
export async function listUserSites(event: H3Event, userId: string) {
  const rows = await useDb(event).select({
    id: sites.id,
    name: sites.name,
    domain: sites.domain,
    status: sites.status,
    role: userSiteRoles.role,
  })
    .from(userSiteRoles)
    .innerJoin(sites, eq(sites.id, userSiteRoles.siteId))
    .where(eq(userSiteRoles.userId, userId))
  return rows
    .filter(r => r.status !== 'suspended')
    .map(r => ({ id: r.id, name: r.name, domain: r.domain, role: r.role, origin: siteOriginForDomain(r.domain) }))
}
