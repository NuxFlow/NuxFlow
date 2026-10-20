import { z } from 'zod'
import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { parsePagination } from '../../../../utils/pagination'
import { getFormByIdOrThrow } from '../../../../utils/resource-queries'
import { paginate, countRows } from '@nuxflow/db/queries'
import { formSubmissions } from '@nuxflow/db/schema'
import { and, eq, desc, inArray, sql } from 'drizzle-orm'

// `status` filters the list: `inbox` = new + read (what the admin shows by default, so
// spam the moderation pass flagged and archived items stay out of the way); a single
// status; or `all` (the default, so existing headless callers get what they always did).
const STATUS_FILTERS = {
  all: null,
  inbox: ['new', 'read'],
  new: ['new'],
  read: ['read'],
  archived: ['archived'],
  spam: ['spam'],
} as const

const querySchema = z.object({
  status: z.enum(['all', 'inbox', 'new', 'read', 'archived', 'spam']).default('all'),
})

export default defineEventHandler(async (event) => {
  await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const formIdentifier = getRouterParam(event, 'formIdentifier')!
  const query = getQuery(event)
  const { status } = parseQuery(event, querySchema)

  const form = await getFormByIdOrThrow(db, siteId, formIdentifier, 'Form not found', { id: true, name: true, slug: true, fields: true })

  const base = and(eq(formSubmissions.formId, form.id), eq(formSubmissions.siteId, siteId))
  const statuses = STATUS_FILTERS[status]
  const where = statuses ? and(base, inArray(formSubmissions.status, [...statuses])) : base

  const { page, perPage, limit, offset } = parsePagination(query)
  const { items: submissions, total } = await paginate(
    countRows(db, formSubmissions, where),
    () => db.query.formSubmissions.findMany({ where, orderBy: [desc(formSubmissions.createdAt)], limit, offset }),
  )

  // Per-status totals for the filter tabs — one grouped query on (form_id, status), which
  // idx_form_submissions_form_status covers.
  const grouped = await db
    .select({ status: formSubmissions.status, count: sql<number>`count(*)` })
    .from(formSubmissions)
    .where(base)
    .groupBy(formSubmissions.status)
  const counts = { new: 0, read: 0, archived: 0, spam: 0 }
  for (const row of grouped) counts[row.status] = Number(row.count)

  return { form, submissions, page, perPage, total, counts }
})
