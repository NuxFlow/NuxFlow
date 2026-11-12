import { syncDueFeeds } from '../utils/availability'

/** Hourly: refreshes holiday lets' followed calendars (server/utils/availability.ts). */
export async function syncAvailabilityFeeds() {
  return syncDueFeeds()
}
