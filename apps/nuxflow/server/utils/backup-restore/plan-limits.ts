import type { PlanLimitKey } from '../../../shared/lib/hosting-plan-limits'
import { planLimit } from '../../../shared/lib/hosting-plan-limits'
import type { RestoreResult } from '../backup-types'

/**
 * Records that a restore skipped something because the site's hosting plan was full, so
 * the result explains its "skipped" counts instead of looking like duplicates.
 */
export function noteLimit(result: RestoreResult, key: PlanLimitKey): void {
  const label = planLimit(key).label
  result.planLimits ??= []
  if (!result.planLimits.includes(label)) result.planLimits.push(label)
}
