import { reconcileStuckVideos } from '../scheduled/reconcile-stuck-videos'

export default defineTask({
  meta: {
    name: 'reconcile-stuck-videos',
    description: 'Mark video_assets rows stuck at status:processing past a TTL as failed',
  },
  async run() {
    const result = await reconcileStuckVideos()
    return { result }
  },
})
