// ── Dynamic plugins restore ────────────────────────────────────────────────────
// Unlike every other backup section, dynamicPlugins.id is the publisher-assigned
// manifest id — it's both the KV key segment and the primary key, so (a) it's the
// natural restore-matching key and (b) there's no way to "archive" a duplicate: a
// second row can't reuse the same id (primary key), and a different id would use a
// different KV namespace entirely, i.e. not actually be a restore of this plugin. So
// conflictMode 'archive' behaves like 'skip' here, and only 'overwrite' can touch an
// existing install. Every restored plugin is re-verified (checksum + Ed25519 signature
// + publisher-key trust pinning) exactly as server/api/v1/dynamic-plugins/index.post.ts
// does on a fresh install — a backup.json is user-editable before upload, so nothing
// about its embedded code is trusted until it re-proves the same signature.
import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { dynamicPlugins, dynamicPluginTrust } from '@nuxflow/db/schema'
import { ulid } from 'ulid'
import type { Db } from '../db'
import { putPluginServerCode, putPluginClientBundle } from '../cf-plugin-kv'
import { verifyPluginSignature, computeSha256 } from '../plugin-signing'
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

  // Fails closed: code/bundle present with no checksum to verify against is rejected,
  // not silently passed through — see the superRefine on backupDynamicPluginSchema for
  // why a missing checksum here can't be trusted just because the signature "matches"
  // (the signature would have been computed over the 'none' placeholder instead). A
  // throw from computeSha256 itself (e.g. an unsupported input) is treated the same as
  // a checksum mismatch — this plugin fails verification — rather than being allowed to
  // propagate and abort the entire restore, matching how a signature-verify failure
  // right below is already handled.
  if (backupPlugin.serverCode) {
    if (!backupPlugin.serverChecksum) {
      result.plugins.rejected++
      return
    }
    let actual: string | null
    try {
      actual = await computeSha256(backupPlugin.serverCode)
    } catch {
      actual = null
    }
    if (actual !== backupPlugin.serverChecksum) {
      result.plugins.rejected++
      return
    }
  }
  if (backupPlugin.clientBundle) {
    if (!backupPlugin.clientChecksum) {
      result.plugins.rejected++
      return
    }
    let actual: string | null
    try {
      actual = await computeSha256(backupPlugin.clientBundle)
    } catch {
      actual = null
    }
    if (actual !== backupPlugin.clientChecksum) {
      result.plugins.rejected++
      return
    }
  }

  let signatureValid: boolean
  try {
    signatureValid = await verifyPluginSignature(backupPlugin.publisherPublicKey, {
      id: backupPlugin.pluginId,
      version: backupPlugin.version,
      serverChecksum: backupPlugin.serverChecksum ?? 'none',
      clientChecksum: backupPlugin.clientChecksum ?? 'none',
      definitionsChecksum: backupPlugin.definitionsChecksum ?? 'none',
    }, backupPlugin.signature)
  } catch {
    signatureValid = false
  }
  if (!signatureValid) {
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

  // dynamicPlugins.id has no per-site scoping in its primary key (see the comment
  // above) — a plugin id already installed on a DIFFERENT site can't also be inserted
  // here, that's a raw SQLITE_CONSTRAINT_PRIMARYKEY away. Checked only on the insert
  // path (not the update-existing path below, which is already this exact row).
  if (!existing) {
    const elsewhere = await db.query.dynamicPlugins.findFirst({
      where: eq(dynamicPlugins.id, backupPlugin.pluginId),
      columns: { id: true },
    })
    if (elsewhere) {
      result.plugins.skipped++
      return
    }
  }

  if (backupPlugin.serverCode) await putPluginServerCode(event, siteId, backupPlugin.pluginId, backupPlugin.serverCode)
  if (backupPlugin.clientBundle) await putPluginClientBundle(event, siteId, backupPlugin.pluginId, backupPlugin.clientBundle)

  if (existing) {
    await db.update(dynamicPlugins).set({
      name: backupPlugin.name,
      version: backupPlugin.version,
      description: backupPlugin.description,
      hasServer: Boolean(backupPlugin.serverCode),
      hasClient: Boolean(backupPlugin.clientBundle),
      serverChecksum: backupPlugin.serverChecksum,
      clientChecksum: backupPlugin.clientChecksum,
      blockDefinitions: backupPlugin.blockDefinitions,
      definitionsChecksum: backupPlugin.definitionsChecksum,
      publisherPublicKey: backupPlugin.publisherPublicKey,
      signature: backupPlugin.signature,
    }).where(eq(dynamicPlugins.id, existing.id))
    result.plugins.updated++
  } else {
    await db.insert(dynamicPlugins).values({
      id: backupPlugin.pluginId,
      siteId,
      name: backupPlugin.name,
      version: backupPlugin.version,
      description: backupPlugin.description,
      isActive: false,
      hasServer: Boolean(backupPlugin.serverCode),
      hasClient: Boolean(backupPlugin.clientBundle),
      serverChecksum: backupPlugin.serverChecksum,
      clientChecksum: backupPlugin.clientChecksum,
      blockDefinitions: backupPlugin.blockDefinitions,
      definitionsChecksum: backupPlugin.definitionsChecksum,
      publisherPublicKey: backupPlugin.publisherPublicKey,
      signature: backupPlugin.signature,
    })
    result.plugins.created++
    if (!trust) {
      await db.insert(dynamicPluginTrust).values({
        id: ulid(), siteId, pluginId: backupPlugin.pluginId, publisherPublicKey: backupPlugin.publisherPublicKey,
      })
    }
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
