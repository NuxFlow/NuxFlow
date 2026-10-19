import { useDb } from '../../../utils/db'
import { requireRoleOrApiKey } from '../../../utils/permissions'
import { writeAuditLog } from '../../../utils/audit'
import { putPluginServerCode, putPluginClientBundle } from '../../../utils/cf-plugin-kv'
import { pluginPackageSchema, verifyPluginPackage, assertPublisherTrusted } from '../../../utils/plugin-package'
import { dynamicPlugins, dynamicPluginTrust } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import { notifySiteRole } from '../../../utils/notify'
import { waitUntil } from '../../../utils/cf-env'
import { assertWithinPlan } from '../../../utils/hosting-plans'

// Installs a signed plugin package. Every artifact is checksum-verified and the Ed25519
// signature must cover them all, capabilities included (see plugin-package.ts). Installed
// plugins always start inactive with no permissions granted: an admin reviews what it asks
// for and approves it when enabling (enable.post.ts).
export default defineEventHandler(async (event) => {
  const { userId } = await requireRoleOrApiKey(event, 'admin', 'manage:plugins')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const body = await parseBody(event, pluginPackageSchema)

  const existing = await db.query.dynamicPlugins.findFirst({
    where: and(eq(dynamicPlugins.id, body.id), eq(dynamicPlugins.siteId, siteId)),
    columns: { id: true },
  })
  if (existing) throw conflict('Plugin already installed — use PUT /api/v1/dynamic-plugins/:id (`nuxflow plugin update`) to update it')
  await assertWithinPlan(event, 'plugins')

  const pkg = await verifyPluginPackage(body)

  // Publisher-key pinning survives delete/reinstall — only the super-admin trust reset
  // clears it, for intentional key rotation.
  const trusted = await assertPublisherTrusted(db, siteId, pkg.id, pkg.publisherPublicKey)

  if (pkg.serverCode) await putPluginServerCode(event, siteId, pkg.id, pkg.serverCode)
  if (pkg.clientCode) await putPluginClientBundle(event, siteId, pkg.id, pkg.clientCode)

  // Installed plugins always start inactive (see enable.post.ts) — so this alone never
  // flips GET /api/public/site's cached `hasPlugins` flag and needs no purge here; that
  // flag only changes on enable/disable/delete (each of which purges it themselves).
  await db.insert(dynamicPlugins).values({
    id: pkg.id,
    siteId,
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    isActive: false,
    hasServer: Boolean(pkg.serverCode),
    hasClient: Boolean(pkg.clientCode),
    serverChecksum: pkg.serverChecksum,
    clientChecksum: pkg.clientChecksum,
    blockDefinitions: pkg.blockDefinitions,
    definitionsChecksum: pkg.definitionsChecksum,
    capabilities: pkg.capabilitiesText,
    capabilitiesChecksum: pkg.capabilitiesChecksum,
    grantedPermissions: null,
    publisherPublicKey: pkg.publisherPublicKey,
    signature: pkg.signature,
  })

  if (!trusted) {
    await db.insert(dynamicPluginTrust).values({
      id: ulid(),
      siteId,
      pluginId: pkg.id,
      publisherPublicKey: pkg.publisherPublicKey,
    })
  }

  await writeAuditLog(event, userId, {
    action: 'install',
    resource: 'dynamic_plugin',
    resourceId: pkg.id,
    after: { name: pkg.name, version: pkg.version, permissions: pkg.capabilities.permissions },
  })
  // Plugins run code on this site — every other admin should hear about a new one.
  waitUntil(event, notifySiteRole(event, {
    siteId,
    minRole: 'admin',
    excludeUserId: userId,
    type: 'system.plugin_installed',
    title: `Plugin installed: ${pkg.name}`,
    body: `${pkg.name} ${pkg.version} was installed on this site. Review it under Admin → Plugins if you weren't expecting this.`,
    sendEmailNotification: true,
    pushUrl: '/admin/plugins',
    actionLabel: 'Review plugins',
  }).catch(err => console.error('[plugins] Install notification failed:', err)))

  return { success: true }
})
