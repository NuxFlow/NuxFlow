import { useDb } from '../../../utils/db'
import { dynamicPlugins } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const db = useDb(event)
  const siteId = event.context.siteId as string
  if (!siteId) return { plugins: [] }

  const rows = await db.query.dynamicPlugins.findMany({
    where: eq(dynamicPlugins.siteId, siteId),
  })

  return { plugins: rows }
})
