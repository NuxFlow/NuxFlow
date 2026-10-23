import { useDb } from '../utils/db'
import { createSystemEvent } from '../utils/system-event'
import { syncVideoWatchUsage } from '../utils/video-usage'

/**
 * Hourly: counts minutes watched of the platform's Stream video and pauses or resumes
 * each hosted site's videos against its plan (utils/video-usage.ts). Does nothing unless
 * this install runs as a hosting platform with videos in the platform's Stream account.
 */
export const videoUsage = async () => {
  return syncVideoWatchUsage(useDb(), (siteId, host) => createSystemEvent({ env: globalThis.__env__, siteId, host }))
}
