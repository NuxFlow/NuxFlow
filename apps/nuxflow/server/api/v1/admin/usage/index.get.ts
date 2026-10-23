import { z } from 'zod'
import { requireSuperAdmin } from '../../../../utils/permissions'
import { requireHostingPlatform } from '../../../../utils/hosting-platform'
import { parseQuery } from '../../../../utils/validate'
import { monthlyUsageEverywhere } from '../../../../utils/usage-report'
import { utcDay } from '../../../../utils/utc-day'

const querySchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
})

/**
 * Every site's usage for one calendar month (UTC) — this Worker's and every member pool's
 * (utils/usage-report.ts). Pools that can't be reached are named in `unreachablePools`.
 */
export default defineEventHandler(async (event) => {
  await requireSuperAdmin(event)
  await requireHostingPlatform(event)
  const { month = utcDay().slice(0, 7) } = parseQuery(event, querySchema)
  return { month, ...await monthlyUsageEverywhere(event, month) }
})
