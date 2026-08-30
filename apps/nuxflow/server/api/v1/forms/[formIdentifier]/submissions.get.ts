import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { parsePagination } from '../../../../utils/pagination'
import { getFormByIdOrThrow } from '../../../../utils/resource-queries'
import { formSubmissions } from '@nuxflow/db/schema'
import { and, eq, desc } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const formIdentifier = getRouterParam(event, 'formIdentifier')!
  const query = getQuery(event)

  const form = await getFormByIdOrThrow(db, siteId, formIdentifier, 'Form not found', { id: true, name: true, fields: true })

  const { page, perPage, limit, offset } = parsePagination(query)

  const submissions = await db.query.formSubmissions.findMany({
    where: and(eq(formSubmissions.formId, formIdentifier), eq(formSubmissions.siteId, siteId)),
    orderBy: [desc(formSubmissions.createdAt)],
    limit,
    offset,
  })

  return { form, submissions, page, perPage }
})
