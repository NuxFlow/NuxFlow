// Verifies a signed plugin package — shared by install (POST /api/v1/dynamic-plugins),
// update (PUT /api/v1/dynamic-plugins/:id) and backup restore, so all three apply exactly
// the same checks. Nothing in a package is trusted until it passes: every artifact must
// match its checksum, and the Ed25519 signature must cover id + version + every checksum
// (including the capabilities, so permissions can't be added to a signed plugin).
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { dynamicPluginTrust } from '@nuxflow/db/schema'
import type { Db } from './db'
import { computeSha256, verifyPluginSignature } from './plugin-signing'
import { parsePluginCapabilities, type PluginCapabilities } from '../../shared/lib/plugin-permissions'
import { base64ToBytes } from '../../shared/lib/base64'

// Letters, digits, dot, underscore, hyphen — never ':' or '/', which would break the KV key
// (`plugin:{site}:{id}:…`) and the /_nuxflow/ext/{id}/ path.
const PLUGIN_ID_RE = /^[a-z0-9][\w.-]{0,99}$/i

// Shape/type validation only — checksum matching and signature verification happen in
// verifyPluginPackage(), unconditionally, against the fields this schema confirms are strings.
export const pluginPackageSchema = z.object({
  id: z.string().regex(PLUGIN_ID_RE, 'Plugin id may only use letters, digits, dots, underscores and hyphens (max 100)'),
  name: z.string().min(1).max(200),
  version: z.string().min(1).max(50),
  description: z.string().max(2000).optional(),
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
  /** Raw JSON text `{ permissions, settings }` from the manifest — exactly as signed. */
  capabilities: z.string().min(1).max(100_000).optional(),
  /** SHA-256 hex of the raw capabilities text. */
  capabilitiesChecksum: z.string().min(1).optional(),
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
  if (body.capabilities && !body.capabilitiesChecksum) {
    ctx.addIssue({ code: 'custom', message: 'capabilitiesChecksum is required when capabilities is present', path: ['capabilitiesChecksum'] })
  }
})

export type PluginPackage = z.infer<typeof pluginPackageSchema>

export interface VerifiedPluginPackage {
  id: string
  name: string
  version: string
  description: string
  serverCode: string | null
  clientCode: string | null
  serverChecksum: string | null
  clientChecksum: string | null
  blockDefinitions: Record<string, unknown>[] | null
  definitionsChecksum: string | null
  capabilitiesText: string | null
  capabilitiesChecksum: string | null
  capabilities: PluginCapabilities
  publisherPublicKey: string
  signature: string
}

function decodeBase64(encoded: string): string {
  try {
    return new TextDecoder().decode(base64ToBytes(encoded))
  } catch {
    throw badRequest('Plugin code must be base64-encoded')
  }
}

async function assertChecksum(text: string, expected: string, label: string): Promise<void> {
  if (await computeSha256(text) !== expected) {
    throw badRequest(`${label} checksum mismatch — payload may be corrupted or tampered`)
  }
}

/** Parses capabilities text (null = none). Throws 400 with a readable reason. */
export function parseCapabilitiesText(text: string | null): PluginCapabilities {
  if (!text) return { permissions: [], settings: [] }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw badRequest('capabilities is not valid JSON')
  }
  try {
    return parsePluginCapabilities(raw)
  } catch (err) {
    throw badRequest(`Invalid plugin capabilities: ${(err as Error).message}`)
  }
}

export interface DecodedArtifacts {
  id: string
  version: string
  serverCode: string | null
  clientCode: string | null
  definitionsText: string | null
  capabilitiesText: string | null
  serverChecksum: string | null
  clientChecksum: string | null
  definitionsChecksum: string | null
  capabilitiesChecksum: string | null
  publisherPublicKey: string
  signature: string
}

/**
 * Checksums every artifact and verifies the publisher signature over them. Throws 400 on
 * any mismatch. Shared with backup restore, whose payload holds already-decoded text.
 */
export async function verifyArtifacts(a: DecodedArtifacts): Promise<void> {
  // Fails closed: an artifact without a checksum can't be covered by the signature (it
  // would have been signed over the 'none' placeholder instead).
  if (a.serverCode !== null && !a.serverChecksum) throw badRequest('serverChecksum is required when server code is present')
  if (a.clientCode !== null && !a.clientChecksum) throw badRequest('clientChecksum is required when client code is present')
  if (a.definitionsText !== null && !a.definitionsChecksum) throw badRequest('definitionsChecksum is required when block definitions are present')
  if (a.capabilitiesText !== null && !a.capabilitiesChecksum) throw badRequest('capabilitiesChecksum is required when capabilities are present')

  if (a.serverCode !== null) await assertChecksum(a.serverCode, a.serverChecksum!, 'serverModule')
  if (a.clientCode !== null) await assertChecksum(a.clientCode, a.clientChecksum!, 'clientBundle')
  if (a.definitionsText !== null) await assertChecksum(a.definitionsText, a.definitionsChecksum!, 'blockDefinitions')
  if (a.capabilitiesText !== null) await assertChecksum(a.capabilitiesText, a.capabilitiesChecksum!, 'capabilities')

  let valid: boolean
  try {
    valid = await verifyPluginSignature(a.publisherPublicKey, {
      id: a.id,
      version: a.version,
      serverChecksum: a.serverChecksum ?? 'none',
      clientChecksum: a.clientChecksum ?? 'none',
      definitionsChecksum: a.definitionsChecksum ?? 'none',
      ...(a.capabilitiesChecksum ? { capabilitiesChecksum: a.capabilitiesChecksum } : {}),
    }, a.signature)
  } catch {
    throw badRequest('Invalid publisherPublicKey format')
  }
  if (!valid) {
    throw badRequest('Plugin signature verification failed — the payload was not signed by the declared publisher key')
  }
}

function parseBlockDefinitions(text: string | null): Record<string, unknown>[] | null {
  if (text === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw badRequest('blockDefinitions is not valid JSON')
  }
  // Plain data, never executed — still shape-checked so a malformed payload fails here
  // rather than surfacing as a broken block picker later.
  if (!Array.isArray(parsed) || parsed.some(b => typeof b !== 'object' || b === null || typeof (b as Record<string, unknown>).id !== 'string' || typeof (b as Record<string, unknown>).name !== 'string')) {
    throw badRequest('blockDefinitions must be an array of objects each with at least string "id" and "name" fields')
  }
  return parsed as Record<string, unknown>[]
}

export async function verifyPluginPackage(body: PluginPackage): Promise<VerifiedPluginPackage> {
  const serverCode = body.serverModule ? decodeBase64(body.serverModule) : null
  const clientCode = body.clientBundle ? decodeBase64(body.clientBundle) : null
  const definitionsText = body.blockDefinitions ? decodeBase64(body.blockDefinitions) : null
  const capabilitiesText = body.capabilities ?? null

  await verifyArtifacts({
    id: body.id,
    version: body.version,
    serverCode,
    clientCode,
    definitionsText,
    capabilitiesText,
    serverChecksum: body.serverChecksum ?? null,
    clientChecksum: body.clientChecksum ?? null,
    definitionsChecksum: body.definitionsChecksum ?? null,
    capabilitiesChecksum: body.capabilitiesChecksum ?? null,
    publisherPublicKey: body.publisherPublicKey,
    signature: body.signature,
  })

  const capabilities = parseCapabilitiesText(capabilitiesText)
  // Hooks, network access and the rest only exist on the server half — a client-only
  // plugin asking for them would show the admin permissions that can never be used.
  if (!serverCode && capabilities.permissions.length > 0) {
    throw badRequest('Permissions need a server module (src/server.ts) — a client-only plugin cannot use them')
  }

  return {
    id: body.id,
    name: body.name,
    version: body.version,
    description: body.description ?? '',
    serverCode,
    clientCode,
    serverChecksum: body.serverChecksum ?? null,
    clientChecksum: body.clientChecksum ?? null,
    blockDefinitions: parseBlockDefinitions(definitionsText),
    definitionsChecksum: body.definitionsChecksum ?? null,
    capabilitiesText,
    capabilitiesChecksum: body.capabilitiesChecksum ?? null,
    capabilities,
    publisherPublicKey: body.publisherPublicKey,
    signature: body.signature,
  }
}

/**
 * Publisher-key pinning: a plugin id first installed under one key can't be replaced by a
 * package signed with another, across delete/reinstall and updates. Returns whether a
 * trust record already exists (so the caller knows to create one).
 */
export async function assertPublisherTrusted(db: Db, siteId: string, pluginId: string, publisherPublicKey: string): Promise<boolean> {
  const trust = await db.query.dynamicPluginTrust.findFirst({
    where: and(eq(dynamicPluginTrust.siteId, siteId), eq(dynamicPluginTrust.pluginId, pluginId)),
  })
  if (trust && trust.publisherPublicKey !== publisherPublicKey) {
    throw conflict(`Plugin "${pluginId}" was previously installed under a different publisher key. If this is an intentional key rotation by the same publisher, a super admin must reset its trust record first (DELETE /api/v1/dynamic-plugins/${pluginId}/trust).`)
  }
  return Boolean(trust)
}
