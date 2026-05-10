import { useDb } from '../utils/db'
import { sites } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  // Let setup & auth API paths through before touching the DB — the schema
  // may not exist yet (fresh install / wiped DB awaiting migrations).
  const path = event.path
  if (path.startsWith('/api/v1/setup') || path.startsWith('/api/auth') || path === '/api/health') {
    return
  }

  const host = getHeader(event, 'host')?.split(':')[0] ?? ''
  const db = useDb(event)

  let site: { id: string; status: string; setupCompleted: boolean } | undefined
  try {
    site = await db.query.sites.findFirst({
      where: eq(sites.domain, host),
      columns: { id: true, status: true, setupCompleted: true },
    })
  } catch {
    // DB not yet migrated — treat as no site so the setup guard can redirect.
    site = undefined
  }

  event.context.siteId = site?.id ?? null
  event.context.siteStatus = site?.status ?? null
  event.context.setupCompleted = site?.setupCompleted ?? false

  if (site?.status === 'maintenance') {
    throw createError({ statusCode: 503, message: 'Site is under maintenance' })
  }
})
