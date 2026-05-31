import { useDb } from '../../../utils/db'
import { sites, users } from '@nuxflow/db/schema'
import { count } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const db = useDb(event)

  try {
    const [siteCount] = await db.select({ value: count() }).from(sites)
    const [userCount] = await db.select({ value: count() }).from(users)

    const hasSite = (siteCount?.value ?? 0) > 0
    const hasAdmin = (userCount?.value ?? 0) > 0

    let setupCompleted = false
    if (hasSite) {
      const site = await db.query.sites.findFirst({
        columns: { setupCompleted: true },
      })
      setupCompleted = site?.setupCompleted ?? false
    }

    return {
      hasSite,
      hasAdmin,
      setupCompleted,
      needsSetup: !hasSite || !hasAdmin || !setupCompleted,
    }
  } catch {
    // DB schema not yet migrated — report as needing setup.
    return { hasSite: false, hasAdmin: false, setupCompleted: false, needsSetup: true }
  }
})
