import { rebuildSearchIndex } from '../scheduled/search-index-rebuild'
import type { ScheduledCloudflareContext } from '../scheduled/publish-scheduled'

export default defineTask({
  meta: {
    name: 'search-index-rebuild',
    description: 'Re-embed published pages into the Vectorize index after it changes',
  },
  async run(event) {
    // Labelled re-throw, as in publish-scheduled.ts: Cloudflare's cron runner logs an
    // uncaught rejection with no task name.
    try {
      const cloudflare = (event?.context as { cloudflare?: ScheduledCloudflareContext } | undefined)?.cloudflare
      return { result: await rebuildSearchIndex(cloudflare) }
    } catch (err) {
      console.error('[search-index-rebuild] task failed:', err)
      throw err
    }
  },
})
