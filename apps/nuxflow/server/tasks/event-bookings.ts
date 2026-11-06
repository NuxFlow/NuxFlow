import { sweepEventBookings } from '../scheduled/event-bookings'
import type { ScheduledCloudflareContext } from '../scheduled/publish-scheduled'

export default defineTask({
  meta: {
    name: 'event-bookings',
    description: 'Release places whose time has run out and send day-before reminders',
  },
  async run(event) {
    try {
      const cloudflare = (event?.context as { cloudflare?: ScheduledCloudflareContext } | undefined)?.cloudflare
      return { result: await sweepEventBookings(cloudflare) }
    }
    catch (err) {
      console.error('[event-bookings] task failed:', err)
      throw err
    }
  },
})
