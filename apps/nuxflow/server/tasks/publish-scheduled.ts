import { publishScheduled } from '../scheduled/publish-scheduled'
import type { ScheduledCloudflareContext } from '../scheduled/publish-scheduled'

export default defineTask({
  meta: {
    name: 'publish-scheduled',
    description: 'Publish content items whose scheduledAt has passed',
  },
  async run(event) {
    // Cloudflare's production cron runner fires every registered task via
    // `Promise.all(tasks.map(runTask))` with no per-task `.catch` (unlike the dev-only
    // node-cron path, which does), so an uncaught rejection here surfaces only as a
    // generic unhandled-rejection log with no task name attached. Catching and
    // re-throwing with a labeled message gives Cloudflare's tail actual attribution.
    try {
      // The cron run's env + ExecutionContext — needed to deliver plugin hooks for what
      // this run publishes (see publishScheduled).
      const cloudflare = (event?.context as { cloudflare?: ScheduledCloudflareContext } | undefined)?.cloudflare
      const result = await publishScheduled(cloudflare)
      return { result }
    } catch (err) {
      console.error('[publish-scheduled] task failed:', err)
      throw err
    }
  },
})
