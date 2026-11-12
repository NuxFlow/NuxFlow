import { syncAvailabilityFeeds } from '../scheduled/availability-sync'

export default defineTask({
  meta: {
    name: 'availability-sync',
    description: 'Refresh holiday lets\' booked nights from their Airbnb / Booking.com calendars',
  },
  async run() {
    try {
      return { result: await syncAvailabilityFeeds() }
    }
    catch (err) {
      console.error('[availability-sync] task failed:', err)
      throw err
    }
  },
})
