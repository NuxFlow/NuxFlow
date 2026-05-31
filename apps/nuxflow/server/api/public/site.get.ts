import { useDb } from '../../utils/db'
import { sites, siteSettings } from '@nuxflow/db/schema'
import { and, eq, inArray } from 'drizzle-orm'

const FRONTEND_KEYS = ['frontend.show_header', 'frontend.show_color_toggle', 'appearance.favicon_url'] as const

export default defineEventHandler(async (event) => {
  const siteId = event.context.siteId as string | null
  if (!siteId) throw createError({ statusCode: 404 })

  const db = useDb(event)
  const site = await db.query.sites.findFirst({
    where: eq(sites.id, siteId),
    columns: { name: true, domain: true },
  })
  if (!site) throw createError({ statusCode: 404 })

  const rows = await db.query.siteSettings.findMany({
    where: and(eq(siteSettings.siteId, siteId), inArray(siteSettings.key, [...FRONTEND_KEYS])),
  })

  const kvMap = Object.fromEntries(rows.map(r => [r.key, r.value]))

  return {
    ...site,
    showHeader: (kvMap['frontend.show_header'] as boolean | undefined) !== false,
    showColorToggle: (kvMap['frontend.show_color_toggle'] as boolean | undefined) !== false,
    faviconUrl: (kvMap['appearance.favicon_url'] as string | undefined) ?? null,
  }
})
