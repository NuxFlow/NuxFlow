import { eq } from 'drizzle-orm'
import { sites } from '@nuxflow/db/schema'
import { useDb } from '../utils/db'
import { createSystemEvent } from '../utils/system-event'
import { checkPendingCustomDomains } from '../utils/hosting-domains'

/**
 * Hourly: re-checks customers' own domains that aren't live yet, so each owner is emailed
 * when theirs starts working (hosting-domains.ts). Does nothing unless this install runs
 * as a hosting platform with the Cloudflare details set.
 */
export const checkCustomDomains = async () => {
  const primary = await useDb().query.sites.findFirst({ where: eq(sites.isPrimary, true), columns: { id: true, domain: true } })
  if (!primary) return { checked: 0, live: 0 }
  const event = createSystemEvent({ env: globalThis.__env__, siteId: primary.id, host: primary.domain })
  return checkPendingCustomDomains(event)
}
