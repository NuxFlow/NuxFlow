import { demoFirstBoot } from '../scheduled/demo-reset'

export default defineTask({
  meta: {
    name: 'demo-reset',
    description: 'Seeds the demo database on first boot if it is empty',
  },
  async run() {
    // See publish-scheduled.ts for why this try/catch exists: Cloudflare's production
    // cron runner gives no per-task error isolation or attribution on its own.
    try {
      const result = await demoFirstBoot()
      return { result }
    } catch (err) {
      console.error('[demo-reset] task failed:', err)
      throw err
    }
  },
})
