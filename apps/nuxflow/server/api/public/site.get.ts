import { useDb } from '../../utils/db'
import { sites } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const siteId = event.context.siteId as string | null
  if (!siteId) throw createError({ statusCode: 404 })

  const db = useDb(event)
  const site = await db.query.sites.findFirst({
    where: eq(sites.id, siteId),
    columns: { name: true, domain: true },
  })
  if (!site) throw createError({ statusCode: 404 })

  return site
})
