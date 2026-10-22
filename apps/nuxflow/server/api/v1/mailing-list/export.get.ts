import { z } from 'zod'
import { and, asc, eq, gt } from 'drizzle-orm'
import { mailingListSubscribers } from '@nuxflow/db/schema'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { writeAuditLog } from '../../../utils/audit'
import { csvField } from '../../../utils/mailing-list'
import { requireSiteId } from '../../../utils/site-context'

const querySchema = z.object({
  status: z.enum(['pending', 'subscribed', 'unsubscribed']).optional(),
})

const PAGE = 1000

// CSV of the list — for moving it to a newsletter service, or keeping a copy. Read in
// pages keyed on id (no OFFSET), streamed out as each page arrives.
export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const { status } = parseQuery(event, querySchema)

  await writeAuditLog(event, userId, { action: 'export', resource: 'mailing_list', after: { status: status ?? 'all' } })

  setHeader(event, 'Content-Type', 'text/csv; charset=utf-8')
  setHeader(event, 'Content-Disposition', `attachment; filename="mailing-list-${status ?? 'all'}-${new Date().toISOString().slice(0, 10)}.csv"`)
  setHeader(event, 'Cache-Control', 'no-store')

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
  const writer = writable.getWriter()
  const encoder = new TextEncoder()

  const produce = async () => {
    try {
      await writer.write(encoder.encode('email,name,status,source,signed_up,confirmed,unsubscribed,consent_text\r\n'))
      let after = ''
      for (;;) {
        const rows = await db.query.mailingListSubscribers.findMany({
          where: and(
            eq(mailingListSubscribers.siteId, siteId),
            status ? eq(mailingListSubscribers.status, status) : undefined,
            after ? gt(mailingListSubscribers.id, after) : undefined,
          ),
          orderBy: [asc(mailingListSubscribers.id)],
          limit: PAGE,
        })
        if (rows.length === 0) break
        const chunk = rows.map(r => [
          r.email, r.name, r.status, r.source, r.createdAt, r.confirmedAt, r.unsubscribedAt, r.consentText,
        ].map(csvField).join(',')).join('\r\n')
        await writer.write(encoder.encode(`${chunk}\r\n`))
        if (rows.length < PAGE) break
        after = rows[rows.length - 1]!.id
      }
      await writer.close()
    }
    catch (err) {
      console.error('[mailing-list] CSV export failed:', err)
      await writer.abort(err)
    }
  }
  void produce()
  return sendStream(event, readable)
})
