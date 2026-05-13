import { requireRole } from '../../utils/permissions'
import { buildBackup } from '../../utils/backup'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const siteId = event.context.siteId as string

  const backup = await buildBackup(event, siteId)
  const filename = `nuxflow-backup-${new Date().toISOString().slice(0, 10)}.json`

  setHeader(event, 'Content-Type', 'application/json')
  setHeader(event, 'Content-Disposition', `attachment; filename="${filename}"`)
  return JSON.stringify(backup, null, 2)
})
