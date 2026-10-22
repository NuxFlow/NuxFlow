import { syncPoolDirectory } from '../scheduled/pool-directory-sync'

export default defineTask({
  meta: {
    name: 'pool-directory-sync',
    description: 'Rebuild the site directory the front-door router uses, from what the member pools report',
  },
  async run() {
    // See publish-scheduled.ts for why this try/catch exists: Cloudflare's production
    // cron runner gives no per-task error isolation or attribution on its own.
    try {
      const result = await syncPoolDirectory()
      return { result }
    } catch (err) {
      console.error('[pool-directory-sync] task failed:', err)
      throw err
    }
  },
})
