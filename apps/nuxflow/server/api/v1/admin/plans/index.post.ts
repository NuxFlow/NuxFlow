import { ulid } from 'ulid'
import { hostingPlans } from '@nuxflow/db/schema'
import { useDb } from '../../../../utils/db'
import { requireSuperAdmin } from '../../../../utils/permissions'
import { writeAuditLog } from '../../../../utils/audit'
import { created } from '../../../../utils/response'
import { planBodySchema } from '../../../../utils/hosting-plan-schema'

export default defineEventHandler(async (event) => {
  const { userId } = await requireSuperAdmin(event)
  const body = await parseBody(event, planBodySchema)
  const db = useDb(event)
  const id = ulid()
  const [plan] = await db.insert(hostingPlans).values({ id, ...body }).returning()
  await writeAuditLog(event, userId, { action: 'create', resource: 'hosting_plan', resourceId: id, after: body })
  return created(event, plan)
})
