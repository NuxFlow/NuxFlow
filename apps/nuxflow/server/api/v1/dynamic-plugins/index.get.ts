import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { parseCapabilitiesText } from '../../../utils/plugin-package'
import { permissionsCovered } from '../../../../shared/lib/plugin-permissions'
import { dynamicPlugins } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  if (!siteId) return { plugins: [] }

  const rows = await db.query.dynamicPlugins.findMany({
    where: eq(dynamicPlugins.siteId, siteId),
  })

  return {
    // settingsValues is never sent (it holds encrypted secrets) — the settings form reads
    // a masked copy from GET /api/v1/dynamic-plugins/:id/settings instead.
    plugins: rows.map(({ settingsValues: _settings, capabilities, ...row }) => {
      const parsed = (() => {
        try {
          return parseCapabilitiesText(capabilities)
        } catch {
          return { permissions: [], settings: [] }
        }
      })()
      return {
        ...row,
        permissions: parsed.permissions,
        grantedPermissions: row.grantedPermissions ?? [],
        hasSettings: parsed.settings.length > 0,
        // Asks for permissions that haven't been approved — enabling shows the review.
        needsApproval: !permissionsCovered(parsed.permissions, row.grantedPermissions),
      }
    }),
  }
})
