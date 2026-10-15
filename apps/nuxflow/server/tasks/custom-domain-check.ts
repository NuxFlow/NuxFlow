import { checkCustomDomains } from '../scheduled/custom-domain-check'

export default defineTask({
  meta: {
    name: 'custom-domain-check',
    description: "Check customers' own domains that aren't live yet, and tell each owner when theirs works",
  },
  async run() {
    // See publish-scheduled.ts for why this try/catch exists: Cloudflare's production
    // cron runner gives no per-task error isolation or attribution on its own.
    try {
      const result = await checkCustomDomains()
      return { result }
    } catch (err) {
      console.error('[custom-domain-check] task failed:', err)
      throw err
    }
  },
})
