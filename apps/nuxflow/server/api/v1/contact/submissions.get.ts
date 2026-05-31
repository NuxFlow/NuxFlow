import { forms, formSubmissions } from '@nuxflow/db/schema'
import { and, eq, desc } from 'drizzle-orm'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const query = getQuery(event)

  const form = await db.query.forms.findFirst({
    where: and(eq(forms.siteId, siteId), eq(forms.slug, 'contact')),
    columns: { id: true },
  })

  if (!form) return { submissions: [], total: 0 }

  const page = Math.max(1, Number(query.page ?? 1))
  const perPage = 50

  const submissions = await db.query.formSubmissions.findMany({
    where: and(eq(formSubmissions.formId, form.id), eq(formSubmissions.siteId, siteId)),
    orderBy: [desc(formSubmissions.createdAt)],
    limit: perPage,
    offset: (page - 1) * perPage,
  })

  return { submissions, page, perPage }
})
