import type { H3Event } from 'h3'
import { useDb } from './db'
import { resolveBooleanSetting } from './settings'
import { broadcastPushToSite } from './webpush'
import { contentHookFor } from './plugin-hooks'
import { itemPublicPath } from './public-page'
import { waitUntil } from './cf-env'

type ContentState = Parameters<typeof contentHookFor>[0]

interface PublishedItem {
  title: string
  slug: string
  locale?: string | null
  sourceItemId?: string | null
}

/**
 * The "New content published" push broadcast (Settings → Push). Fires on the same
 * transition as the plugin `content.published` hook — an item becoming published *and*
 * public — so a members-only or private item never has its title pushed to every
 * subscriber. Every path that publishes calls this next to its content hook: the editor
 * (PATCH), create-as-published (POST), MCP, and scheduled publishing.
 * The event must be for `siteId`'s site.
 */
export async function pushContentPublished(event: H3Event, siteId: string, before: ContentState, after: ContentState, item: PublishedItem): Promise<void> {
  if (contentHookFor(before, after) !== 'content.published') return
  if (!(await resolveBooleanSetting(event, 'push.events.content_published'))) return
  await broadcastPushToSite(event, {
    title: item.title,
    body: 'New content has been published.',
    url: await itemPublicPath(useDb(event), siteId, item),
  })
}

/** pushContentPublished in the background, for request handlers. */
export function queueContentPublishedPush(event: H3Event, siteId: string, before: ContentState, after: ContentState, item: PublishedItem): void {
  waitUntil(event, pushContentPublished(event, siteId, before, after, item)
    .catch(err => console.error('[push] Content publish broadcast failed:', err)))
}
