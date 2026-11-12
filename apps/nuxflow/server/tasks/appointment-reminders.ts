import { sendAppointmentReminders } from '../scheduled/appointment-reminders'
import type { ScheduledCloudflareContext } from '../scheduled/publish-scheduled'

export default defineTask({
  meta: {
    name: 'appointment-reminders',
    description: 'Send day-before reminders for one-to-one appointments',
  },
  async run(event) {
    try {
      const cloudflare = (event?.context as { cloudflare?: ScheduledCloudflareContext } | undefined)?.cloudflare
      return { result: await sendAppointmentReminders(cloudflare) }
    }
    catch (err) {
      console.error('[appointment-reminders] task failed:', err)
      throw err
    }
  },
})
