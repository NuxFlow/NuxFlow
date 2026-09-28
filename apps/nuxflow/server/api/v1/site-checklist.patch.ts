import { z } from 'zod'
import { requireRole } from '../../utils/permissions'
import { batchSaveSettings } from '../../utils/settings'
import { writeAuditLog } from '../../utils/audit'
import {
  buildSetupChecklist, CHECKLIST_HIDDEN_KEY, CHECKLIST_SKIPPED_KEY,
  gatherSetupChecklistInputs, getChecklistPreferences,
} from '../../utils/setup-checklist'

const bodySchema = z.object({
  // Skip (or un-skip) one recommended item.
  skip: z.string().max(40).optional(),
  unskip: z.string().max(40).optional(),
  // Hide/show the whole card.
  hidden: z.boolean().optional(),
})

/**
 * Dashboard checklist preferences. Only *recommended* items can be skipped, and the card
 * can only be hidden once every essential item is done — the point of the essential tier
 * is that it can't be dismissed while it still matters.
 */
export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const body = await parseBody(event, bodySchema)

  const [inputs, prefs] = await Promise.all([gatherSetupChecklistInputs(event, userId), getChecklistPreferences(event)])
  const items = buildSetupChecklist(inputs)
  const byId = new Map(items.map(i => [i.id, i]))

  const skipped = new Set(prefs.skipped)
  if (body.skip) {
    const item = byId.get(body.skip)
    if (!item) validationError(`Unknown checklist item "${body.skip}"`)
    if (item.tier === 'essential') validationError('Essential setup steps can\'t be skipped')
    skipped.add(body.skip)
  }
  if (body.unskip) skipped.delete(body.unskip)

  if (body.hidden === true && items.some(i => (i.tier === 'essential' && i.status !== 'done') || i.status === 'problem')) {
    validationError('Finish the essential steps first — the checklist can be hidden once they\'re done')
  }

  const entries: [string, unknown][] = [[CHECKLIST_SKIPPED_KEY, [...skipped]]]
  if (body.hidden !== undefined) entries.push([CHECKLIST_HIDDEN_KEY, body.hidden])
  await batchSaveSettings(event, entries)
  await writeAuditLog(event, userId, { action: 'update', resource: 'settings', after: { keys: entries.map(([k]) => k) } })

  return { skipped: [...skipped], hidden: body.hidden ?? prefs.hidden }
})
