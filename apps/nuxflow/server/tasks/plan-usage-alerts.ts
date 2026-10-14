import { sendPlanUsageAlerts } from '../scheduled/plan-usage-alerts'

export default defineTask({
  meta: {
    name: 'plan-usage-alerts',
    description: 'Tell the platform operator when a site reaches 80% or 100% of a monthly hosting-plan limit',
  },
  async run() {
    // See publish-scheduled.ts for why this try/catch exists: Cloudflare's production
    // cron runner gives no per-task error isolation or attribution on its own.
    try {
      const result = await sendPlanUsageAlerts()
      return { result }
    } catch (err) {
      console.error('[plan-usage-alerts] task failed:', err)
      throw err
    }
  },
})
