import type { H3Event } from 'h3'
import { z } from 'zod'
import { purgeEdgeCache, purgeAllPublicPages } from './edge-cache'
import { waitUntil } from './cf-env'

// Shared by the menu routes (server/api/v1/menus/*) and the MCP menu tools.

export const MENU_LOCATIONS = ['header', 'footer', 'sidebar'] as const

const menuLinkFields = {
  id: z.string().optional(),
  label: z.string(),
  type: z.enum(['page', 'url']).optional(),
  url: z.string().optional(),
  contentId: z.string().optional(),
  slug: z.string().optional(),
  target: z.enum(['_self', '_blank']).default('_self'),
}

/** A menu's items: links with at most one level of children. */
export const menuItemsSchema = z.array(z.object({
  ...menuLinkFields,
  children: z.array(z.object(menuLinkFields)).default([]),
}))

/**
 * Purges what a menu change can affect: each location's public menu JSON, and — because
 * header/footer menus render into every page's shared chrome — every cached public page.
 */
export async function purgeMenuLocations(event: H3Event, siteId: string, locations: (string | null | undefined)[]): Promise<void> {
  const unique = [...new Set(locations.filter((l): l is string => Boolean(l)))]
  if (!unique.length) return
  await purgeEdgeCache(event, unique.map(l => `/api/public/menus/${l}`))
  if (unique.includes('header') || unique.includes('footer')) {
    waitUntil(event, purgeAllPublicPages(event, siteId).catch((err) => {
      console.error('[menus] Failed to purge page cache after a menu change:', err)
    }))
  }
}
