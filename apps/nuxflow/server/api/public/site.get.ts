import type { H3Event } from 'h3'
import { useDb } from '../../utils/db'
import { sites, siteSettings } from '@nuxflow/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { withEdgeCache } from '../../utils/edge-cache'

const FRONTEND_KEYS = ['frontend.show_header', 'frontend.show_color_toggle', 'frontend.show_search', 'frontend.show_sticky_header', 'frontend.logo_size', 'appearance.favicon_url', 'appearance.logo_url', 'seo.canonical_url', 'integrations.turnstile_site_key', 'layout.header_block', 'layout.footer_block'] as const

const CACHE_MAX_AGE = 300

async function buildPayload(event: H3Event, siteId: string) {
  const db = useDb(event)
  const site = await db.query.sites.findFirst({
    where: eq(sites.id, siteId),
    columns: { name: true, domain: true, locale: true },
  })
  if (!site) throw createError({ statusCode: 404 })

  const rows = await db.query.siteSettings.findMany({
    where: and(eq(siteSettings.siteId, siteId), inArray(siteSettings.key, [...FRONTEND_KEYS])),
  })

  const kvMap = Object.fromEntries(rows.map(r => [r.key, r.value]))

  const canonicalSetting = (kvMap['seo.canonical_url'] as string | undefined)?.trim()
  const canonicalBase = canonicalSetting || `https://${site.domain}`

  return {
    ...site,
    showHeader: (kvMap['frontend.show_header'] as boolean | undefined) !== false,
    showColorToggle: (kvMap['frontend.show_color_toggle'] as boolean | undefined) !== false,
    showSearch: (kvMap['frontend.show_search'] as boolean | undefined) !== false,
    showStickyHeader: (kvMap['frontend.show_sticky_header'] as boolean | undefined) !== false,
    logoSize: (kvMap['frontend.logo_size'] as string | undefined) ?? 'md',
    faviconUrl: (kvMap['appearance.favicon_url'] as string | undefined) ?? null,
    logoUrl: (kvMap['appearance.logo_url'] as string | undefined) ?? null,
    canonicalBase,
    turnstileSiteKey: (kvMap['integrations.turnstile_site_key'] as string | undefined) || null,
    // Block id (from the block registry — see useBlockRegistry.ts) that a
    // dynamic plugin registered to own this layout region, e.g. 'my-theme/header'.
    // Unset/unresolvable → the layout falls back to the built-in component.
    headerBlockId: (kvMap['layout.header_block'] as string | undefined) || null,
    footerBlockId: (kvMap['layout.footer_block'] as string | undefined) || null,
  }
}

export default defineEventHandler(async (event) => {
  const siteId = event.context.siteId as string | null
  if (!siteId) throw createError({ statusCode: 404 })

  // Fetched on effectively every client-side page navigation for header/footer chrome.
  // Cached at the edge (Cloudflare Cache API) — TTL-only, no explicit invalidation on
  // settings save, matching the same window this route already promises via
  // Cache-Control below.
  setHeader(event, 'Cache-Control', `public, max-age=${CACHE_MAX_AGE}, stale-while-revalidate=3600`)

  return withEdgeCache(event, CACHE_MAX_AGE, () => buildPayload(event, siteId))
})
