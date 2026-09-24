import { bufferToHex } from '../utils/buffer'
import { useDb } from '../utils/db'
import { waitUntil } from '../utils/cf-env'
import { apiKeys, userSiteRoles } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const authHeader = getHeader(event, 'authorization')
  if (!authHeader?.startsWith('Bearer ')) return

  // API key auth only applies once a site has been resolved
  const siteId = event.context.siteId
  if (!siteId) return

  const rawKey = authHeader.slice(7)
  const db = useDb(event)

  // Hash the raw key with SHA-256 for comparison
  const encoder = new TextEncoder()
  const data = encoder.encode(rawKey)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const keyHash = bufferToHex(hashBuffer)

  // Scope lookup to the current site so a key from Site A cannot authenticate on Site B
  const apiKey = await db.query.apiKeys.findFirst({
    where: and(eq(apiKeys.keyHash, keyHash), eq(apiKeys.siteId, siteId)),
  })

  if (!apiKey) return

  // Check expiry
  if (apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date()) return

  // Update last used — in the background, off the request's critical path. Drizzle query
  // builders are lazy thenables that only execute once awaited/then()'d, so the previous
  // bare `void db.update(...)` never actually ran; Promise.resolve() adopts the thenable,
  // which is what triggers execution, and waitUntil keeps the Worker alive until it lands.
  waitUntil(event, Promise.resolve(
    db.update(apiKeys).set({ lastUsedAt: new Date().toISOString() }).where(eq(apiKeys.id, apiKey.id)),
  ).catch(err => console.error('[api-key-auth] Failed to record lastUsedAt:', err)))

  // Resolve role for this site. Deleting a user's userSiteRoles row (removing them
  // from the site) does not cascade-delete their API keys — those live on until
  // explicitly revoked — so a missing row here means access was revoked after the
  // key was issued, not "give them a default role". Every consumer of these context
  // fields (content/index.get.ts, public pages preview, mcp.ts) treats apiKeyUserId's
  // mere presence as "this is an authenticated request", so leaving both unset makes
  // a revoked key behave exactly like an unrecognized one instead of a residual
  // 'viewer'.
  const roleRow = await db.query.userSiteRoles.findFirst({
    where: and(eq(userSiteRoles.userId, apiKey.userId), eq(userSiteRoles.siteId, siteId)),
  })
  if (!roleRow) return

  event.context.apiKeyUserId = apiKey.userId
  event.context.apiKeyRole = roleRow.role
  event.context.apiKeyScopes = apiKey.scopes
})
