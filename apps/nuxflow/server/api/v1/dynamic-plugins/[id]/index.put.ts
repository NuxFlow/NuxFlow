import { useDb } from '../../../../utils/db'
import { requireRoleOrApiKey } from '../../../../utils/permissions'
import { writeAuditLog } from '../../../../utils/audit'
import { putPluginServerCode, putPluginClientBundle, deletePluginAssets } from '../../../../utils/cf-plugin-kv'
import { pluginPackageSchema, verifyPluginPackage, assertPublisherTrusted, parseCapabilitiesText } from '../../../../utils/plugin-package'
import { carryOverPluginSettings } from '../../../../utils/plugin-settings'
import { getDynamicPluginByIdOrThrow } from '../../../../utils/resource-queries'
import { scopedById } from '../../../../utils/db-helpers'
import { purgeEdgeCache } from '../../../../utils/edge-cache'
import { notifySiteRole } from '../../../../utils/notify'
import { waitUntil } from '../../../../utils/cf-env'
import { permissionsCovered } from '../../../../../shared/lib/plugin-permissions'
import { dynamicPlugins } from '@nuxflow/db/schema'
import { sql } from 'drizzle-orm'

// Updates an installed plugin in place — same verification as a fresh install, plus the
// package must be signed by the key this plugin id is pinned to. Unlike the old
// delete-then-reinstall, the plugin keeps its settings, its stored data and its approval.
// An update that asks for a permission the admin hasn't approved switches the plugin off
// until an admin reviews and re-enables it — code can't gain powers by updating itself.
export default defineEventHandler(async (event) => {
  const { userId } = await requireRoleOrApiKey(event, 'admin', 'manage:plugins')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!
  const body = await parseBody(event, pluginPackageSchema)
  if (body.id !== id) throw badRequest(`Package id "${body.id}" does not match the plugin being updated ("${id}")`)

  const existing = await getDynamicPluginByIdOrThrow(db, siteId, id)
  const pkg = await verifyPluginPackage(body)
  await assertPublisherTrusted(db, siteId, id, pkg.publisherPublicKey)
  if (existing.publisherPublicKey && existing.publisherPublicKey !== pkg.publisherPublicKey) {
    throw conflict('This update is signed by a different publisher key than the installed plugin.')
  }

  const granted = existing.grantedPermissions ?? []
  const needsApproval = existing.isActive && !permissionsCovered(pkg.capabilities.permissions, granted)
  const previousSettings = parseCapabilitiesText(existing.capabilities).settings

  if (pkg.serverCode) await putPluginServerCode(event, siteId, id, pkg.serverCode)
  if (pkg.clientCode) await putPluginClientBundle(event, siteId, id, pkg.clientCode)

  await db.update(dynamicPlugins).set({
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    hasServer: Boolean(pkg.serverCode),
    hasClient: Boolean(pkg.clientCode),
    serverChecksum: pkg.serverChecksum,
    clientChecksum: pkg.clientChecksum,
    blockDefinitions: pkg.blockDefinitions,
    definitionsChecksum: pkg.definitionsChecksum,
    capabilities: pkg.capabilitiesText,
    capabilitiesChecksum: pkg.capabilitiesChecksum,
    // A permission the new version no longer asks for is dropped from the grant too, so
    // re-adding it later needs a fresh approval.
    grantedPermissions: granted.filter(p => pkg.capabilities.permissions.includes(p)),
    settingsValues: carryOverPluginSettings(pkg.capabilities.settings, previousSettings, existing.settingsValues ?? null),
    isActive: needsApproval ? false : existing.isActive,
    signature: pkg.signature,
    updatedAt: sql`(datetime('now'))`,
  }).where(scopedById(dynamicPlugins.id, id, dynamicPlugins.siteId, siteId))

  // The row now points at the new checksums; earlier versions' code can go.
  waitUntil(event, deletePluginAssets(event, siteId, id, [pkg.serverChecksum, pkg.clientChecksum])
    .catch(err => console.error('[plugins] Old plugin code cleanup failed:', err)))

  await writeAuditLog(event, userId, {
    action: 'update',
    resource: 'dynamic_plugin',
    resourceId: id,
    before: { version: existing.version, isActive: existing.isActive },
    after: { version: pkg.version, permissions: pkg.capabilities.permissions, disabledForApproval: needsApproval },
  })
  await purgeEdgeCache(event, [`/_nuxflow/plugin-bundle/${id}`, '/api/public/dynamic-plugins', '/api/public/site'])

  waitUntil(event, notifySiteRole(event, {
    siteId,
    minRole: 'admin',
    excludeUserId: userId,
    type: 'system.plugin_installed',
    title: needsApproval ? `Plugin needs approval: ${pkg.name}` : `Plugin updated: ${pkg.name}`,
    body: needsApproval
      ? `${pkg.name} ${pkg.version} asks for new permissions, so it has been switched off. Review and re-enable it under Admin → Plugins.`
      : `${pkg.name} was updated to ${pkg.version}.`,
    sendEmailNotification: true,
    pushUrl: '/admin/plugins',
    actionLabel: 'Review plugins',
  }).catch(err => console.error('[plugins] Update notification failed:', err)))

  return { success: true, isActive: needsApproval ? false : existing.isActive, needsApproval }
})
