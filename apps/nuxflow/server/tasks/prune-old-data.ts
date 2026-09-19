import { pruneOldData } from '../scheduled/prune-old-data'

export default defineTask({
  meta: {
    name: 'prune-old-data',
    description: 'Delete audit logs older than the retention window and trim content revisions beyond the per-item limit',
  },
  async run() {
    // See publish-scheduled.ts for why this try/catch exists: Cloudflare's production
    // cron runner gives no per-task error isolation or attribution on its own.
    try {
      const result = await pruneOldData()
      return { result }
    } catch (err) {
      console.error('[prune-old-data] task failed:', err)
      throw err
    }
  },
})
