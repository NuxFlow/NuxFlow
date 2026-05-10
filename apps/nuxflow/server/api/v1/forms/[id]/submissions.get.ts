import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { formSubmissions, forms } from '@nuxflow/db/schema'
import { and, eq, desc } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const formId = getRouterParam(event, 'id')!
  const query = getQuery(event)

  const form = await db.query.forms.findFirst({
    where: and(eq(forms.id, formId), eq(forms.siteId, siteId)),
    columns: { id: true, name: true, fields: true },
  })
  if (!form) throw createError({ statusCode: 404, message: 'Form not found' })

  const page = Number(query.page ?? 1)
  const perPage = 50

  const submissions = await db.query.formSubmissions.findMany({
    where: and(eq(formSubmissions.formId, formId), eq(formSubmissions.siteId, siteId)),
    orderBy: [desc(formSubmissions.createdAt)],
    limit: perPage,
    offset: (page - 1) * perPage,
  })

  return { form, submissions, page, perPage }
})
