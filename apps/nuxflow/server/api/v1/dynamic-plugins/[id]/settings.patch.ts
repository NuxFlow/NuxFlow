import { z } from 'zod'
import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../../utils/audit'
import { getDynamicPluginByIdOrThrow } from '../../../../utils/resource-queries'
import { parseCapabilitiesText } from '../../../../utils/plugin-package'
import { buildStoredPluginSettings, maskPluginSettings } from '../../../../utils/plugin-settings'
import { scopedById } from '../../../../utils/db-helpers'
import { dynamicPlugins } from '@nuxflow/db/schema'

const bodySchema = z.object({
  values: z.record(z.string(), z.unknown()),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!
  const body = await parseBody(event, bodySchema)

  const plugin = await getDynamicPluginByIdOrThrow(db, siteId, id)
  const { settings } = parseCapabilitiesText(plugin.capabilities)
  if (settings.length === 0) throw badRequest('This plugin has no settings')

  const next = await buildStoredPluginSettings(settings, plugin.settingsValues ?? null, body.values)
  const update = db.update(dynamicPlugins)
    .set({ settingsValues: next })
    .where(scopedById(dynamicPlugins.id, id, dynamicPlugins.siteId, siteId))
  // Only which keys changed — never the values, which may be secrets.
  const changed = settings.map(f => f.key).filter(k => JSON.stringify(next[k]) !== JSON.stringify(plugin.settingsValues?.[k]))
  const auditInsert = buildAuditLogInsert(event, userId, { action: 'update_settings', resource: 'dynamic_plugin', resourceId: id, after: { changed } })
  await batchWithAudit(db, [update], auditInsert)

  return { fields: settings, values: maskPluginSettings(settings, next) }
})
