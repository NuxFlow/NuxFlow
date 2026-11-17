import { useDb } from '../utils/db'
import { createSystemEvent } from '../utils/system-event'
import { saveSetting } from '../utils/settings'
import { CHATBOT_INDEX_STAMP_KEY, sitesNeedingChatIndex, syncSiteChatIndex } from '../utils/chatbot-index'
import type { ScheduledCloudflareContext } from './publish-scheduled'

/** Chunks embedded per run, across every site (each site's sync stops at what's left). */
const RUN_BUDGET = 300

/**
 * Every minute: teaches the chatbot of each site whose pages or knowledge changed (see
 * server/utils/chatbot-index.ts). Three grouped queries when nothing changed.
 */
export const indexChatbots = async (cloudflare?: ScheduledCloudflareContext) => {
  const env = cloudflare?.env ?? globalThis.__env__
  if (!env) return 'no bindings'
  const db = useDb()
  const candidates = await sitesNeedingChatIndex(createSystemEvent({ env, ctx: cloudflare?.context }), db)
  let left = RUN_BUDGET
  let synced = 0
  for (const site of candidates) {
    if (left <= 0) break
    const event = createSystemEvent({ env, ctx: cloudflare?.context, siteId: site.siteId, host: site.domain })
    try {
      const result = await syncSiteChatIndex(event, db, site.siteId, site.settings, left)
      left -= result.embedded
      // Only a complete sync records the stamp, so an unfinished site is picked up again next run.
      if (result.done) {
        await saveSetting(event, CHATBOT_INDEX_STAMP_KEY, site.stamp)
        synced++
      }
    }
    catch (err) {
      console.error(`[chatbot-index] Site ${site.siteId} failed:`, err)
    }
  }
  return candidates.length ? `${synced}/${candidates.length} sites up to date, ${RUN_BUDGET - left} chunks` : 'nothing to do'
}
