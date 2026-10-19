import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { getDynamicPluginByIdOrThrow } from '../../../../utils/resource-queries'
import { parseCapabilitiesText } from '../../../../utils/plugin-package'
import { maskPluginSettings } from '../../../../utils/plugin-settings'

// The plugin's settings form: its declared fields plus the current values, with secret
// values replaced by the mask (never decrypted for the browser).
export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  const plugin = await getDynamicPluginByIdOrThrow(db, siteId, id)
  const { settings } = parseCapabilitiesText(plugin.capabilities)
  return { fields: settings, values: maskPluginSettings(settings, plugin.settingsValues ?? null) }
})
