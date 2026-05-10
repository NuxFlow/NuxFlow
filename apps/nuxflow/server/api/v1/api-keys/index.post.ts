import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
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
  const body = await readValidatedBody(event, bodySchema.parse)

  // Generate a cryptographically random API key using Web Crypto API (Cloudflare Workers compatible)
  const rawBytes = crypto.getRandomValues(new Uint8Array(32))
  const rawKey = `nf_${btoa(String.fromCharCode(...rawBytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')}`

  const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawKey))
  const keyHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')

  const id = ulid()

  await db.insert(apiKeys).values({
    id,
    siteId,
    userId,
    name: body.name,
    keyHash,
    scopes: body.scopes,
    expiresAt: body.expiresAt,
  })

  setResponseStatus(event, 201)
  // Raw key shown only once — client must copy it
  return { id, key: rawKey }
})
