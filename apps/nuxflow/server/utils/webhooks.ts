import { useDb } from './db'
import { webhooks } from '@nuxflow/db/schema'
import { and, eq, sql } from 'drizzle-orm'

async function hmacSha256Hex(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(data))
  return Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function dispatchWebhook(siteId: string, event: string, payload: unknown) {
  const db = useDb()

  const hooks = await db.query.webhooks.findMany({
    where: and(eq(webhooks.siteId, siteId), eq(webhooks.isActive, true)),
  })

  for (const hook of hooks) {
    const events = hook.events as string[]
    if (!events.includes(event) && !events.includes('*')) continue

    try {
      const body = JSON.stringify({ event, payload, timestamp: new Date().toISOString() })
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }

      if (hook.secret) {
        const sig = await hmacSha256Hex(hook.secret, body)
        headers['x-nuxflow-signature'] = `sha256=${sig}`
      }

      await fetch(hook.url, { method: 'POST', headers, body })
      await db.update(webhooks).set({ lastFiredAt: sql`(datetime('now'))` }).where(eq(webhooks.id, hook.id))
    } catch (err) {
      console.error(`[webhooks] Failed to dispatch to ${hook.url}:`, err)
    }
  }
}
