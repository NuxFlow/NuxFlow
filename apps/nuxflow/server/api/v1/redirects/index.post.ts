import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { writeAuditLog } from '../../../utils/audit'
import { created } from '../../../utils/response'
import { redirectRuleSchema, saveRedirect } from '../../../utils/redirects'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const body = await parseBody(event, redirectRuleSchema)

  const saved = await saveRedirect(db, siteId, body, { overwrite: false })
  if (saved.action === 'unchanged') conflict(`A redirect from "${saved.from}" already exists — edit it instead`)

  await writeAuditLog(event, userId, {
    action: 'create',
    resource: 'redirect',
    resourceId: saved.id,
    after: { from: saved.from, to: saved.to, statusCode: saved.statusCode },
  })

  return created(event, { id: saved.id })
})
