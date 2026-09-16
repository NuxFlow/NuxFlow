import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { writeAuditLog } from '../../../utils/audit'
import { putPluginServerCode, putPluginClientBundle } from '../../../utils/cf-env'
import { verifyPluginSignature, computeSha256 } from '../../../utils/plugin-signing'
import { dynamicPlugins, dynamicPluginTrust } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'

// Shape/type validation only — this does not (and cannot) validate cryptographic
// correctness. Checksum matching and Ed25519 signature verification still happen
// below, unconditionally, against the crypto-relevant fields this schema only
// confirms are present and are strings.
const installBodySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().optional(),
  /** Base64-encoded self-contained ES module (exports default fetch handler). */
  serverModule: z.string().min(1).optional(),
  /** SHA-256 hex of the raw decoded serverModule. */
  serverChecksum: z.string().min(1).optional(),
  /** Base64-encoded ES module (exports `renderBlock(blockId, vue)`). */
  clientBundle: z.string().min(1).optional(),
  /** SHA-256 hex of the raw decoded clientBundle. */
  clientChecksum: z.string().min(1).optional(),
  /** Base64-encoded raw text of src/blocks.json (plain data, never executed). */
  blockDefinitions: z.string().min(1).optional(),
  /** SHA-256 hex of the raw decoded blockDefinitions text. */
  definitionsChecksum: z.string().min(1).optional(),
  /** base64url SPKI Ed25519 public key of the plugin publisher. */
  publisherPublicKey: z.string().min(1, 'publisherPublicKey and signature are required — build with `nuxflow plugin build` and deploy with `nuxflow plugin deploy`'),
  /** base64url Ed25519 signature of the canonical payload (id + version + checksums). */
  signature: z.string().min(1, 'publisherPublicKey and signature are required — build with `nuxflow plugin build` and deploy with `nuxflow plugin deploy`'),
}).superRefine((body, ctx) => {
  if (!body.serverModule && !body.clientBundle) {
    ctx.addIssue({ code: 'custom', message: 'At least one of serverModule or clientBundle is required', path: ['serverModule'] })
  }
  if (body.serverModule && !body.serverChecksum) {
    ctx.addIssue({ code: 'custom', message: 'serverChecksum is required when serverModule is present', path: ['serverChecksum'] })
  }
  if (body.clientBundle && !body.clientChecksum) {
    ctx.addIssue({ code: 'custom', message: 'clientChecksum is required when clientBundle is present', path: ['clientChecksum'] })
  }
  if (body.blockDefinitions && !body.definitionsChecksum) {
    ctx.addIssue({ code: 'custom', message: 'definitionsChecksum is required when blockDefinitions is present', path: ['definitionsChecksum'] })
  }
})

type InstallBody = z.infer<typeof installBodySchema>

function decodeBase64(encoded: string): string {
  return Buffer.from(encoded, 'base64').toString('utf-8')
}

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const body: InstallBody = await parseBody(event, installBodySchema)

  // ── Duplicate check ─────────────────────────────────────────────────────────
  const existing = await db.query.dynamicPlugins.findFirst({
    where: and(eq(dynamicPlugins.id, body.id), eq(dynamicPlugins.siteId, siteId)),
  })
  if (existing) throw conflict('Plugin already installed')

  // ── Decode bundles ──────────────────────────────────────────────────────────
  const serverCode = body.serverModule ? decodeBase64(body.serverModule) : null
  const clientCode = body.clientBundle ? decodeBase64(body.clientBundle) : null
  const definitionsText = body.blockDefinitions ? decodeBase64(body.blockDefinitions) : null

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
  if (definitionsText && body.definitionsChecksum) {
    const actual = await computeSha256(definitionsText)
    if (actual !== body.definitionsChecksum) {
      throw badRequest('blockDefinitions checksum mismatch — payload may be corrupted or tampered')
    }
  }

  // ── Parse + shape-check blockDefinitions ─────────────────────────────────────
  // Plain data, never executed — but still validated so a malformed payload fails
  // loudly here rather than surfacing as a broken block picker later.
  let blockDefinitions: Record<string, unknown>[] | null = null
  if (definitionsText) {
    let parsed: unknown
    try {
      parsed = JSON.parse(definitionsText)
    } catch {
      throw badRequest('blockDefinitions is not valid JSON')
    }
    if (!Array.isArray(parsed) || parsed.some(b => typeof b !== 'object' || b === null || typeof (b as Record<string, unknown>).id !== 'string' || typeof (b as Record<string, unknown>).name !== 'string')) {
      throw badRequest('blockDefinitions must be an array of objects each with at least string "id" and "name" fields')
    }
    blockDefinitions = parsed as Record<string, unknown>[]
  }

  // ── Step 2: Verify Ed25519 signature ────────────────────────────────────────
  // The signature covers id + version + all three checksums, so it is
  // cryptographically bound to this exact version of this exact code and metadata.
  // Any modification invalidates it.
  const signingPayload = {
    id: body.id,
    version: body.version,
    serverChecksum: body.serverChecksum ?? 'none',
    clientChecksum: body.clientChecksum ?? 'none',
    definitionsChecksum: body.definitionsChecksum ?? 'none',
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
    blockDefinitions,
    definitionsChecksum: body.definitionsChecksum ?? null,
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
