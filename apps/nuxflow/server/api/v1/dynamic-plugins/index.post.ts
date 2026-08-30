import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { writeAuditLog } from '../../../utils/audit'
import { putPluginServerCode, putPluginClientBundle } from '../../../utils/cf-env'
import { verifyPluginSignature, computeSha256 } from '../../../utils/plugin-signing'
import { dynamicPlugins, dynamicPluginTrust } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'

interface InstallBody {
  id: string
  name: string
  version: string
  description?: string
  /** Base64-encoded self-contained ES module (exports default fetch handler). */
  serverModule?: string
  /** SHA-256 hex of the raw decoded serverModule. */
  serverChecksum?: string
  /** Base64-encoded ES module (exports `register(app: App): void`). */
  clientBundle?: string
  /** SHA-256 hex of the raw decoded clientBundle. */
  clientChecksum?: string
  /** base64url SPKI Ed25519 public key of the plugin publisher. */
  publisherPublicKey: string
  /** base64url Ed25519 signature of the canonical payload (id + version + checksums). */
  signature: string
}

function decodeBase64(encoded: string): string {
  return Buffer.from(encoded, 'base64').toString('utf-8')
}

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const body = await readBody<InstallBody>(event)

  // ── Field presence ──────────────────────────────────────────────────────────
  if (!body.id || !body.name || !body.version) {
    throw badRequest('id, name, and version are required')
  }
  if (!body.serverModule && !body.clientBundle) {
    throw badRequest('At least one of serverModule or clientBundle is required')
  }
  if (!body.publisherPublicKey || !body.signature) {
    throw badRequest('publisherPublicKey and signature are required — build with `nuxflow plugin build` and deploy with `nuxflow plugin deploy`')
  }
  if (body.serverModule && !body.serverChecksum) {
    throw badRequest('serverChecksum is required when serverModule is present')
  }
  if (body.clientBundle && !body.clientChecksum) {
    throw badRequest('clientChecksum is required when clientBundle is present')
  }

  // ── Duplicate check ─────────────────────────────────────────────────────────
  const existing = await db.query.dynamicPlugins.findFirst({
    where: and(eq(dynamicPlugins.id, body.id), eq(dynamicPlugins.siteId, siteId)),
  })
  if (existing) throw conflict('Plugin already installed')

  // ── Decode bundles ──────────────────────────────────────────────────────────
  const serverCode = body.serverModule ? decodeBase64(body.serverModule) : null
  const clientCode = body.clientBundle ? decodeBase64(body.clientBundle) : null

  // ── Step 1: Verify SHA-256 checksums match the decoded code ─────────────────
  // Ensures the base64 payload was not corrupted or swapped in transit.
  if (serverCode && body.serverChecksum) {
    const actual = await computeSha256(serverCode)
    if (actual !== body.serverChecksum) {
      throw badRequest('serverModule checksum mismatch — payload may be corrupted or tampered')
    }
  }
  if (clientCode && body.clientChecksum) {
    const actual = await computeSha256(clientCode)
    if (actual !== body.clientChecksum) {
      throw badRequest('clientBundle checksum mismatch — payload may be corrupted or tampered')
    }
  }

  // ── Step 2: Verify Ed25519 signature ────────────────────────────────────────
  // The signature covers id + version + both checksums, so it is cryptographically
  // bound to this exact version of this exact code. Any modification invalidates it.
  const signingPayload = {
    id: body.id,
    version: body.version,
    serverChecksum: body.serverChecksum ?? 'none',
    clientChecksum: body.clientChecksum ?? 'none',
  }

  let signatureValid: boolean
  try {
    signatureValid = await verifyPluginSignature(body.publisherPublicKey, signingPayload, body.signature)
  } catch {
    throw badRequest('Invalid publisherPublicKey format')
  }

  if (!signatureValid) {
    throw badRequest('Plugin signature verification failed — the payload was not signed by the declared publisher key')
  }

  // ── Step 3: Pin publisher key across reinstalls ─────────────────────────────
  // `plugin update` deletes the old row and installs fresh, so without a record that
  // outlives the row itself, a different key could silently take over a plugin id that
  // was previously trusted. The trust record survives normal delete/reinstall — only the
  // dedicated trust-reset endpoint (super admin only) clears it for intentional key rotation.
  const trust = await db.query.dynamicPluginTrust.findFirst({
    where: and(eq(dynamicPluginTrust.siteId, siteId), eq(dynamicPluginTrust.pluginId, body.id)),
  })
  if (trust && trust.publisherPublicKey !== body.publisherPublicKey) {
    throw conflict(`Plugin "${body.id}" was previously installed under a different publisher key. If this is an intentional key rotation by the same publisher, a super admin must reset its trust record first (DELETE /api/v1/dynamic-plugins/${body.id}/trust).`)
  }

  // ── Store in KV + D1 ────────────────────────────────────────────────────────
  if (serverCode) await putPluginServerCode(event, siteId, body.id, serverCode)
  if (clientCode) await putPluginClientBundle(event, siteId, body.id, clientCode)

  await db.insert(dynamicPlugins).values({
    id: body.id,
    siteId,
    name: body.name,
    version: body.version,
    description: body.description ?? '',
    isActive: false,
    hasServer: Boolean(serverCode),
    hasClient: Boolean(clientCode),
    serverChecksum: body.serverChecksum ?? null,
    clientChecksum: body.clientChecksum ?? null,
    publisherPublicKey: body.publisherPublicKey,
    signature: body.signature,
  })

  if (!trust) {
    await db.insert(dynamicPluginTrust).values({
      id: ulid(),
      siteId,
      pluginId: body.id,
      publisherPublicKey: body.publisherPublicKey,
    })
  }

  await writeAuditLog(event, userId, { action: 'install', resource: 'dynamic_plugin', resourceId: body.id, after: { name: body.name, version: body.version } })

  return { success: true }
})
