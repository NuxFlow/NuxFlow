import type { H3Event } from 'h3'
import { useDb } from './db'
import { siteSettings } from '@nuxflow/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { ulid } from 'ulid'
import { encryptText, decryptText } from './encryption'

// Simple in-memory cache to prevent redundant D1/Turso lookups on every request
const settingsCache = new Map<string, { value: unknown; expires: number }>()
const CACHE_TTL = 30_000 // 30 seconds

export const SENSITIVE_SETTING_KEYS = new Set([
  'email.resend_api_key',
  'email.brevo_api_key',
  'email.zepto_api_key',
  'email.smtp_pass',
  'payments.stripe_secret_key',
  'payments.stripe_webhook_secret',
  'payments.ls_api_key',
  'payments.ls_webhook_secret',
  'payments.paddle_api_key',
  'payments.paddle_webhook_public_key',
  'ai.openai_api_key',
  'ai.anthropic_api_key',
  'ai.gemini_api_key',
])

export const SECRET_MASK = '••••••••••••••••'

/**
 * Resolves a site setting. Checks the database first, decrypts if sensitive, and falls back to environment variables.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function resolveSetting(event: H3Event, key: string, envKey?: string): Promise<any> {
  const siteId = event.context.siteId as string | undefined
  const rc = useRuntimeConfig()

  if (siteId) {
    const cacheKey = `${siteId}:${key}`
    const cached = settingsCache.get(cacheKey)
    if (cached && cached.expires > Date.now()) {
      return cached.value
    }

    try {
      const db = useDb(event)
      const row = await db.query.siteSettings.findFirst({
        where: and(
          eq(siteSettings.siteId, siteId),
          eq(siteSettings.key, key)
        ),
      })

      if (row && row.value !== null && row.value !== '') {
        let val = row.value as string
        if (SENSITIVE_SETTING_KEYS.has(key)) {
          const secret = rc.betterAuthSecret as string
          val = await decryptText(val, secret)
        }
        settingsCache.set(cacheKey, { value: val, expires: Date.now() + CACHE_TTL })
        return val
      }
    } catch (e) {
      console.error(`[settings] Failed to read setting key: ${key}`, e)
    }
  }

  // Fall back to runtimeConfig env variables
  if (envKey) {
    return rc[envKey] || ''
  }

  return ''
}

/**
 * Saves a setting for a site. Encrypts if marked sensitive.
 */
export async function saveSetting(event: H3Event, key: string, value: unknown): Promise<void> {
  const siteId = event.context.siteId as string
  if (!siteId) throw createError({ statusCode: 400, message: 'Missing site ID in context' })

  const rc = useRuntimeConfig()
  const db = useDb(event)

  // Clear memory cache entry
  settingsCache.delete(`${siteId}:${key}`)

  // Handle deletion if empty
  if (value === null || value === undefined || value === '') {
    await db.delete(siteSettings)
      .where(and(eq(siteSettings.siteId, siteId), eq(siteSettings.key, key)))
    return
  }

  // If sensitive setting, encrypt
  let finalValue = value
  if (SENSITIVE_SETTING_KEYS.has(key)) {
    if (typeof value !== 'string') {
      throw createError({ statusCode: 400, message: `Sensitive setting ${key} must be a string` })
    }
    // If it's already the mask, do not update (keep existing)
    if (value === SECRET_MASK) {
      return
    }
    const secret = rc.betterAuthSecret as string
    finalValue = await encryptText(value, secret)
  }

  const existing = await db.query.siteSettings.findFirst({
    where: and(eq(siteSettings.siteId, siteId), eq(siteSettings.key, key)),
  })

  if (existing) {
    await db.update(siteSettings)
      .set({ value: finalValue, updatedAt: sql`(datetime('now'))` })
      .where(and(eq(siteSettings.siteId, siteId), eq(siteSettings.key, key)))
  } else {
    await db.insert(siteSettings).values({
      id: ulid(),
      siteId,
      key,
      value: finalValue,
    })
  }
}
