// ── Dynamic plugins restore ────────────────────────────────────────────────────
// Unlike every other backup section, dynamicPlugins.id is the publisher-assigned
// manifest id — it's both the KV key segment and (with site_id) the primary key, so (a)
// it's the natural restore-matching key and (b) there's no way to "archive" a duplicate: a
// second row can't reuse the same id on this site, and a different id would use a
// different KV namespace entirely, i.e. not actually be a restore of this plugin. So
// conflictMode 'archive' behaves like 'skip' here, and only 'overwrite' can touch an
// existing install. Every restored plugin is re-verified (checksum + Ed25519 signature,
// capabilities included, + publisher-key trust pinning) with the same verifyArtifacts()
// the install endpoint uses — a backup.json is user-editable before upload, so nothing
// about its embedded code or permissions is trusted until it re-proves the signature.
// Restored plugins come back inactive with no permissions granted; an admin approves them
// when enabling.
import type { H3Event } from 'h3'
import { and, eq, sql } from 'drizzle-orm'
import { dynamicPlugins, dynamicPluginTrust, pluginStorage } from '@nuxflow/db/schema'
import { ulid } from 'ulid'
import type { Db } from '../db'
import { checkPlanLimit } from '../hosting-plans'
import { noteLimit } from './plan-limits'
import { putPluginServerCode, putPluginClientBundle } from '../cf-plugin-kv'
import { parseCapabilitiesText, verifyArtifacts } from '../plugin-package'
import { buildStoredPluginSettings } from '../plugin-settings'
import { STORAGE_LIMITS } from '../plugin-api'
import type { PluginCapabilities } from '../../../shared/lib/plugin-permissions'
import type { BackupDynamicPlugin, NuxFlowBackup, RestoreOptions, RestoreResult } from '../backup-types'

// Restores a single plugin entry from the backup. Every early exit increments the
// appropriate result counter and returns rather than throwing — a single bad/tampered
// plugin entry in a (user-editable) backup.json must reject just that plugin, not abort
// the whole restore.
export async function restoreOnePlugin(
  event: H3Event,
  db: Db,
  siteId: string,
  backupPlugin: BackupDynamicPlugin,
  opts: RestoreOptions,
  result: RestoreResult,
): Promise<void> {
  const existing = await db.query.dynamicPlugins.findFirst({
    where: and(eq(dynamicPlugins.siteId, siteId), eq(dynamicPlugins.id, backupPlugin.pluginId)),
  })
  if (existing && opts.conflictMode !== 'overwrite') {
    result.plugins.skipped++
    return
  }
  if (!backupPlugin.serverCode && !backupPlugin.clientBundle) {
    result.plugins.skipped++
    return
  }
  if (!existing && !(await checkPlanLimit(db, siteId, 'plugins')).allowed) {
    noteLimit(result, 'plugins')
    result.plugins.skipped++
    return
  }

  // Fails closed on anything verifyArtifacts rejects — code/bundle/capabilities without a
  // checksum (see the superRefine on backupDynamicPluginSchema for why a missing checksum
  // can't be trusted just because the signature "matches"), a checksum mismatch, a bad
  // signature — and on capabilities that don't parse. Block definitions only survive as
  // their parsed value, not the exact bytes the checksum was computed over, so their
  // checksum is only checked through the signature (they're inert data, never executed).
  let capabilities: PluginCapabilities
  try {
    await verifyArtifacts({
      id: backupPlugin.pluginId,
      version: backupPlugin.version,
      serverCode: backupPlugin.serverCode,
      clientCode: backupPlugin.clientBundle,
      definitionsText: null,
      capabilitiesText: backupPlugin.capabilities ?? null,
      serverChecksum: backupPlugin.serverChecksum,
      clientChecksum: backupPlugin.clientChecksum,
      definitionsChecksum: backupPlugin.definitionsChecksum,
      capabilitiesChecksum: backupPlugin.capabilitiesChecksum ?? null,
      publisherPublicKey: backupPlugin.publisherPublicKey,
      signature: backupPlugin.signature,
    })
    capabilities = parseCapabilitiesText(backupPlugin.capabilities ?? null)
  } catch {
    result.plugins.rejected++
    return
  }

  const trust = await db.query.dynamicPluginTrust.findFirst({
    where: and(eq(dynamicPluginTrust.siteId, siteId), eq(dynamicPluginTrust.pluginId, backupPlugin.pluginId)),
  })
  if (trust && trust.publisherPublicKey !== backupPlugin.publisherPublicKey) {
    result.plugins.rejected++
    return
  }

  // Non-secret settings, validated against the plugin's own declared form. Anything that
  // doesn't fit is dropped (the admin fills it in again) rather than failing the restore.
  let settingsValues: Record<string, unknown> | null = null
  if (backupPlugin.settings) {
    const nonSecret = Object.fromEntries(Object.entries(backupPlugin.settings)
      .filter(([key]) => capabilities.settings.some(f => f.key === key && f.type !== 'secret')))
    try {
      const fields = capabilities.settings.map(f => ({ ...f, required: false }))
      const stored = await buildStoredPluginSettings(fields, null, nonSecret)
      settingsValues = Object.keys(stored).length ? stored : null
    } catch {
      settingsValues = null
    }
  }

  if (backupPlugin.serverCode) await putPluginServerCode(event, siteId, backupPlugin.pluginId, backupPlugin.serverCode)
  if (backupPlugin.clientBundle) await putPluginClientBundle(event, siteId, backupPlugin.pluginId, backupPlugin.clientBundle)

  const row = {
    name: backupPlugin.name,
    version: backupPlugin.version,
    description: backupPlugin.description,
    hasServer: Boolean(backupPlugin.serverCode),
    hasClient: Boolean(backupPlugin.clientBundle),
    serverChecksum: backupPlugin.serverChecksum,
    clientChecksum: backupPlugin.clientChecksum,
    blockDefinitions: backupPlugin.blockDefinitions,
    definitionsChecksum: backupPlugin.definitionsChecksum,
    capabilities: backupPlugin.capabilities ?? null,
    capabilitiesChecksum: backupPlugin.capabilitiesChecksum ?? null,
    settingsValues,
    publisherPublicKey: backupPlugin.publisherPublicKey,
    signature: backupPlugin.signature,
  }

  if (existing) {
    // Overwritten code could ask for different permissions than the admin approved — so,
    // like an update that asks for more, it's switched off and the grant cleared.
    await db.update(dynamicPlugins).set({ ...row, isActive: false, grantedPermissions: null, updatedAt: sql`(datetime('now'))` })
      .where(and(eq(dynamicPlugins.siteId, siteId), eq(dynamicPlugins.id, existing.id)))
    result.plugins.updated++
  } else {
    await db.insert(dynamicPlugins).values({ id: backupPlugin.pluginId, siteId, isActive: false, grantedPermissions: null, ...row })
    result.plugins.created++
    if (!trust) {
      await db.insert(dynamicPluginTrust).values({
        id: ulid(), siteId, pluginId: backupPlugin.pluginId, publisherPublicKey: backupPlugin.publisherPublicKey,
      })
    }
  }

  if (backupPlugin.storage?.length) await restorePluginStorage(db, siteId, backupPlugin.pluginId, backupPlugin.storage)
}

// Replaces the plugin's stored data with the backup's, within the same caps the runtime
// enforces (plugin-api.ts) — oversized values, keys beyond the count and bytes beyond the
// total are skipped.
async function restorePluginStorage(db: Db, siteId: string, pluginId: string, entries: NonNullable<BackupDynamicPlugin['storage']>): Promise<void> {
  await db.delete(pluginStorage).where(and(eq(pluginStorage.siteId, siteId), eq(pluginStorage.pluginId, pluginId)))
  let total = 0
  let keys = 0
  const seen = new Set<string>()
  for (const entry of entries) {
    if (keys >= STORAGE_LIMITS.maxKeys) break
    if (!entry.key || entry.key.length > STORAGE_LIMITS.maxKeyLength || seen.has(entry.key)) continue
    const size = new TextEncoder().encode(entry.value).byteLength
    if (size > STORAGE_LIMITS.maxValueBytes || total + size > STORAGE_LIMITS.maxTotalBytes) continue
    try {
      JSON.parse(entry.value)
    } catch {
      continue
    }
    seen.add(entry.key)
    total += size
    keys++
    await db.insert(pluginStorage).values({ siteId, pluginId, key: entry.key, value: entry.value, size, expiresAt: entry.expiresAt })
  }
}

export async function restorePlugins(
  event: H3Event,
  db: Db,
  siteId: string,
  backup: NuxFlowBackup,
  opts: RestoreOptions,
  result: RestoreResult,
): Promise<void> {
  if (!opts.what.includes('plugins') || !backup.plugins) return

  for (const backupPlugin of backup.plugins) {
    await restoreOnePlugin(event, db, siteId, backupPlugin, opts, result)
  }
}
