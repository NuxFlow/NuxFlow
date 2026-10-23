import { useDb } from '../utils/db'
import { createSystemEvent } from '../utils/system-event'
import { runSearchIndexRebuild } from '../utils/search-index-rebuild'
import type { ScheduledCloudflareContext } from './publish-scheduled'

/**
 * Every minute: a few batches of the smart-search rebuild when the Vectorize index's model
 * has changed, otherwise one KV read (see server/utils/search-index-rebuild.ts).
 */
export const rebuildSearchIndex = async (cloudflare?: ScheduledCloudflareContext) => {
  const env = cloudflare?.env ?? globalThis.__env__
  if (!env) return 'no bindings'
  const event = createSystemEvent({ env, ctx: cloudflare?.context })
  const state = await runSearchIndexRebuild(event, useDb())
  return state ? `${state.status}: ${state.processed} pages` : 'nothing to do'
}
