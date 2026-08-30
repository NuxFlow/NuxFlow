import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { buildAuditLogInsert } from '../../../utils/audit'
import { created } from '../../../utils/response'
import { apiKeys } from '@nuxflow/db/schema'
import { ulid } from 'ulid'

const bodySchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.string()).default(['read:content']),
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
  const keyHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')

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

  await db.batch(auditInsert ? [keyInsert, auditInsert] : [keyInsert])

  // Raw key shown only once — client must copy it
  return created(event, { id, key: rawKey })
})
