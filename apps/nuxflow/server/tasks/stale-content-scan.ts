import { scanStaleContent } from '../scheduled/stale-content-scan'

export default defineTask({
  meta: {
    name: 'stale-content-scan',
    description: 'Notify authors of published content that hasn\'t been updated in a long time',
  },
  async run() {
    // See publish-scheduled.ts for why this try/catch exists: Cloudflare's production
    // cron runner gives no per-task error isolation or attribution on its own.
    try {
      const result = await scanStaleContent()
      return { result }
    } catch (err) {
      console.error('[stale-content-scan] task failed:', err)
      throw err
    }
  },
})
