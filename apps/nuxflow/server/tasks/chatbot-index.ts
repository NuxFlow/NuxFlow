import { indexChatbots } from '../scheduled/chatbot-index'
import type { ScheduledCloudflareContext } from '../scheduled/publish-scheduled'

export default defineTask({
  meta: {
    name: 'chatbot-index',
    description: 'Teach each site\'s chatbot its new and changed pages',
  },
  async run(event) {
    // Labelled re-throw, as in publish-scheduled.ts: Cloudflare's cron runner logs an
    // uncaught rejection with no task name.
    try {
      const cloudflare = (event?.context as { cloudflare?: ScheduledCloudflareContext } | undefined)?.cloudflare
      return { result: await indexChatbots(cloudflare) }
    }
    catch (err) {
      console.error('[chatbot-index] task failed:', err)
      throw err
    }
  },
})
