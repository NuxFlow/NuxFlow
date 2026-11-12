import { requireRole } from '../../utils/permissions'
import { isDemoMode } from '../../utils/demo-mode'
import { buildSetupChecklist, gatherSetupChecklistInputs, getChecklistPreferences } from '../../utils/setup-checklist'
import type { SetupChecklistResponse } from '../../../shared/lib/site-admin-types'

/**
 * The dashboard's "Finish setting up your site" card — see server/utils/setup-checklist.ts.
 * Deliberately not under /api/v1/setup/…: 02.multi-site.ts skips site resolution for that
 * prefix (it belongs to the pre-install wizard).
 */
export default defineEventHandler(async (event): Promise<SetupChecklistResponse> => {
  const { userId } = await requireRole(event, 'admin')
  // The public demo shares one login and can't configure storage, email, a domain and so
  // on (demo-mode.ts blocks them), so the card would only ever be a list of dead ends.
  if (isDemoMode(event)) return { disabled: true as const }

  const [inputs, prefs] = await Promise.all([gatherSetupChecklistInputs(event, userId), getChecklistPreferences(event)])
  const items = buildSetupChecklist(inputs)

  // Essential items can never be skipped; only recommended ones honour the skip list.
  const visible = items.map(item => ({ ...item, skipped: item.tier === 'recommended' && item.status === 'todo' && prefs.skipped.includes(item.id) }))
  const essentialOpen = visible.filter(i => i.tier === 'essential' && i.status !== 'done').length
  const problems = visible.filter(i => i.status === 'problem').length
  const recommendedOpen = visible.filter(i => i.tier === 'recommended' && i.status !== 'done' && !i.skipped).length

  return {
    items: visible,
    summary: { essentialOpen, recommendedOpen, problems, total: visible.length, done: visible.filter(i => i.status === 'done').length },
    // "Hidden" only sticks while everything essential is done and nothing is broken — a
    // storage or email problem that appears later brings the card back on its own.
    hidden: prefs.hidden && essentialOpen === 0 && problems === 0,
  }
})
