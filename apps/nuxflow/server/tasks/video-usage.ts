import { videoUsage } from '../scheduled/video-usage'

export default defineTask({
  meta: {
    name: 'video-usage',
    description: "Count minutes watched of the platform's Stream video and pause sites over their plan",
  },
  async run() {
    // See publish-scheduled.ts for why this try/catch exists: Cloudflare's production
    // cron runner gives no per-task error isolation or attribution on its own.
    try {
      const result = await videoUsage()
      return { result }
    } catch (err) {
      console.error('[video-usage] task failed:', err)
      throw err
    }
  },
})
