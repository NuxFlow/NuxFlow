import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { forms, formSubmissions } from '@nuxflow/db/schema'
import { and, eq, desc, ne, sql } from 'drizzle-orm'
import { requireSiteId } from '../../../utils/site-context'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const items = await db.query.forms.findMany({
    where: eq(forms.siteId, siteId),
    orderBy: [desc(forms.updatedAt)],
    columns: { id: true, name: true, slug: true, status: true, createdAt: true, updatedAt: true },
  })

  // Submission counts for the list (spam excluded), in one grouped query per site.
  const counts = await db
    .select({
      formId: formSubmissions.formId,
      total: sql<number>`count(*)`,
      unread: sql<number>`sum(case when ${formSubmissions.status} = 'new' then 1 else 0 end)`,
    })
    .from(formSubmissions)
    .where(and(eq(formSubmissions.siteId, siteId), ne(formSubmissions.status, 'spam')))
    .groupBy(formSubmissions.formId)
  const byForm = new Map(counts.map(c => [c.formId, c]))

  return {
    forms: items.map(f => ({
      ...f,
      submissionCount: Number(byForm.get(f.id)?.total ?? 0),
      newCount: Number(byForm.get(f.id)?.unread ?? 0),
    })),
  }
})
