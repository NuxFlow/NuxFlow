import { snapshotUsage } from '../scheduled/usage-snapshot'

export default defineTask({
  meta: {
    name: 'usage-snapshot',
    description: 'Record each site\'s nightly usage totals (storage, content, members, plugins)',
  },
  async run() {
    // See publish-scheduled.ts for why this try/catch exists: Cloudflare's production
    // cron runner gives no per-task error isolation or attribution on its own.
    try {
      const result = await snapshotUsage()
      return { result }
    } catch (err) {
      console.error('[usage-snapshot] task failed:', err)
      throw err
    }
  },
})
