import { useDb } from '../utils/db'
import { apiKeys, userSiteRoles } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const authHeader = getHeader(event, 'authorization')
  if (!authHeader?.startsWith('Bearer ')) return

  const rawKey = authHeader.slice(7)
  const db = useDb(event)

  // Hash the raw key with SHA-256 for comparison
  const encoder = new TextEncoder()
  const data = encoder.encode(rawKey)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const keyHash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')

  const apiKey = await db.query.apiKeys.findFirst({
    where: and(eq(apiKeys.keyHash, keyHash), eq(apiKeys.isActive, true)),
  })

  if (!apiKey) return

  // Check expiry
  if (apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date()) return

  // Update last used
  void db.update(apiKeys).set({ lastUsedAt: new Date().toISOString() }).where(eq(apiKeys.id, apiKey.id))

  // Resolve role for this site
  const siteId = event.context.siteId
  if (siteId) {
    const roleRow = await db.query.userSiteRoles.findFirst({
      where: and(eq(userSiteRoles.userId, apiKey.userId), eq(userSiteRoles.siteId, siteId)),
    })
    event.context.apiKeyUserId = apiKey.userId
    event.context.apiKeyRole = roleRow?.role ?? 'viewer'
  }
})
