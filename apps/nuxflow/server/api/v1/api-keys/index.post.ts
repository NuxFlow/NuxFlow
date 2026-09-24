import { z } from 'zod'
import { bufferToHex } from '../../../utils/buffer'
import { useDb } from '../../../utils/db'
import { requireRole, API_KEY_SCOPES } from '../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../utils/audit'
import { created } from '../../../utils/response'
import { apiKeys } from '@nuxflow/db/schema'
import { ulid } from 'ulid'

const bodySchema = z.object({
  name: z.string().min(1).max(100),
  // Restricted to the scopes 03.api-key-auth.ts/mcp.ts actually enforce — an arbitrary
  // free-text scope string used to be accepted and stored but could never mean anything.
  scopes: z.array(z.enum(API_KEY_SCOPES)).min(1).default(['read:content']),
  expiresAt: z.string().datetime().optional(),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const body = await parseBody(event, bodySchema)

  // Generate a cryptographically random API key using Web Crypto API (Cloudflare Workers compatible)
  const rawBytes = crypto.getRandomValues(new Uint8Array(32))
  const rawKey = `nf_${btoa(String.fromCharCode(...rawBytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')}`

  const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawKey))
  const keyHash = bufferToHex(hashBuffer)

  const id = ulid()

  const keyInsert = db.insert(apiKeys).values({
    id,
    siteId,
    userId,
    name: body.name,
    keyHash,
    scopes: body.scopes,
    expiresAt: body.expiresAt,
  })

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'create',
    resource: 'api_key',
    resourceId: id,
    after: { name: body.name, scopes: body.scopes },
  })

  await batchWithAudit(db, [keyInsert], auditInsert)

  // Raw key shown only once — client must copy it
  return created(event, { id, key: rawKey })
})
