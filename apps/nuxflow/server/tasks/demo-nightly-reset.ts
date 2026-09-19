import { demoNightlyReset } from '../scheduled/demo-reset'

export default defineTask({
  meta: {
    name: 'demo-nightly-reset',
    description: 'Wipes and reseeds the demo database — runs on the 0 3 * * * cron',
  },
  async run() {
    // See publish-scheduled.ts for why this try/catch exists: Cloudflare's production
    // cron runner gives no per-task error isolation or attribution on its own.
    try {
      const result = await demoNightlyReset()
      return { result }
    } catch (err) {
      console.error('[demo-nightly-reset] task failed:', err)
      throw err
    }
  },
})
