import { reconcileStuckVideos } from '../scheduled/reconcile-stuck-videos'

export default defineTask({
  meta: {
    name: 'reconcile-stuck-videos',
    description: 'Mark video_assets rows stuck at status:processing past a TTL as failed',
  },
  async run() {
    // See publish-scheduled.ts for why this try/catch exists: Cloudflare's production
    // cron runner gives no per-task error isolation or attribution on its own.
    try {
      const result = await reconcileStuckVideos()
      return { result }
    } catch (err) {
      console.error('[reconcile-stuck-videos] task failed:', err)
      throw err
    }
  },
})
