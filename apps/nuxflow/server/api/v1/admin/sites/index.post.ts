import { z } from 'zod'
import { useDb } from '../../../../utils/db'
import { requireSuperAdmin } from '../../../../utils/permissions'
import { sites } from '@nuxflow/db/schema'
import { ulid } from 'ulid'

const bodySchema = z.object({
  name: z.string().min(1).max(100),
  domain: z.string().min(1),
  locale: z.string().default('en'),
  timezone: z.string().default('UTC'),
})

export default defineEventHandler(async (event) => {
  await requireSuperAdmin(event)
  const db = useDb(event)
  const body = await readValidatedBody(event, bodySchema.parse)

  const id = ulid()

  // One-time token required to complete /setup for this site — only the hash is persisted,
  // so this is the only chance to hand the raw token to the caller.
  const rawBytes = crypto.getRandomValues(new Uint8Array(32))
  const setupToken = btoa(String.fromCharCode(...rawBytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  const setupTokenHash = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(setupToken)))
  ).map(b => b.toString(16).padStart(2, '0')).join('')

  await db.insert(sites).values({ id, ...body, setupCompleted: false, setupTokenHash })
  setResponseStatus(event, 201)
  return { id, setupToken }
})
