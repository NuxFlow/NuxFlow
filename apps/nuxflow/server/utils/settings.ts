import type { H3Event } from 'h3'
import { useDb } from './db'
import { siteSettings } from '@nuxflow/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { ulid } from 'ulid'
import { encryptText, decryptText } from './encryption'
import { createIsolateCache } from './isolate-cache'
import type { BatchItem } from 'drizzle-orm/batch'

// Per-isolate cache to prevent redundant D1 lookups on every request
const settingsCache = createIsolateCache<unknown>(30_000)

export const SENSITIVE_SETTING_KEYS = new Set([
  'email.resend_api_key',
  'email.brevo_api_key',
  'email.zepto_api_key',
  'payments.stripe_secret_key',
  'payments.stripe_webhook_secret',
  'payments.ls_api_key',
  'payments.ls_webhook_secret',
  'payments.paddle_api_key',
  // NOTE: payments.paddle_webhook_public_key is deliberately NOT in this set — it's a
  // *public* verification key (used only to verify Paddle's incoming webhook signatures,
  // never to sign anything), so there's no secrecy requirement. Marking it sensitive here
  // would just cost an unnecessary encrypt/decrypt round trip on a value that was never
  // secret in the first place.
  'ai.openai_api_key',
  'ai.anthropic_api_key',
  'ai.gemini_api_key',
  'ai.deepseek_api_key',
  'push.vapid_private_key',
  'cloudflare.stream_token',
  'cloudflare.images_token',
  // media.s3_access_key (an AWS Access Key ID) is not independently exploitable without
  // its paired media.s3_secret_key, but it's kept sensitive for defense-in-depth: the two
  // are stored in the same settings blob, and returning the access key unmasked widens
  // exposure (logs, browser extensions, a compromised lower-trust session) more than
  // necessary for no real benefit — nothing legitimate needs to read it in plaintext from
  // the settings API.
  'media.s3_access_key',
  'media.s3_secret_key',
  'media.bunny_api_key',
  // SMS provider credentials — added proactively ahead of SMS feature implementation
  'sms.twilio_auth_token',
  'sms.vonage_api_secret',
  'sms.brevo_api_key',
  'sms.telnyx_api_key',
  // Social login (Google/GitHub) OAuth client secrets — client IDs are not
  // sensitive (they're visible in the browser's OAuth redirect URL regardless)
  // and are intentionally excluded from this set.
  'auth.google_client_secret',
  'auth.github_client_secret',
])

export const SECRET_MASK = '••••••••••••••••'

// Keys that used to live in SENSITIVE_SETTING_KEYS and so may still hold a value
// encrypted under the old regime in an existing deployment's DB (payments.paddle_webhook_public_key
// was reclassified as non-sensitive — it's a public verification key, never a secret).
// resolveSetting() below transparently decrypts a stored value for these keys if it's
// still in the old `ivB64:cipherB64` shape, so an already-encrypted row doesn't start
// coming back as unusable ciphertext the moment the key stops being treated as sensitive.
const FORMERLY_SENSITIVE_SETTING_KEYS = new Set([
  'payments.paddle_webhook_public_key',
])

// Matches this module's `ivBase64Url:ciphertextBase64Url` encryptText() output format.
// Used only to decide whether a formerly-sensitive key's stored value needs one-time
// decryption — real plaintext values for these keys (e.g. a PEM public key) never
// happen to match this shape.
function looksLikeEncryptedValue(val: string): boolean {
  const parts = val.split(':')
  return parts.length === 2 && parts.every(p => p.length > 0 && /^[\w-]+$/.test(p))
}

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
    if (cached !== undefined) {
      return cached
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
          try {
            val = await decryptText(val, secret)
          } catch {
            // Value was stored before encryption was enforced (plaintext migration).
            // Use the raw value — next save will encrypt it properly.
            console.warn(`[settings] Could not decrypt ${key}, using raw stored value`)
          }
        } else if (FORMERLY_SENSITIVE_SETTING_KEYS.has(key) && looksLikeEncryptedValue(val)) {
          // One-time migration path: this key used to be encrypted; transparently
          // decrypt an old row instead of returning unusable ciphertext.
          const secret = rc.betterAuthSecret as string
          try {
            val = await decryptText(val, secret)
          } catch {
            console.warn(`[settings] Could not decrypt formerly-sensitive ${key}, using raw stored value`)
          }
        }
        settingsCache.set(cacheKey, val)
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

// Drizzle query builders implement `.then()` (they're lazy — only executing when
// awaited), which means an `async function` that `return`s one directly gets it
// silently awaited/executed by JS's own thenable-flattening on the way out — defeating
// the whole point of handing back an unexecuted statement to fold into a db.batch().
// Wrapping it in a plain, non-thenable object sidesteps that.
interface PreparedWrite { statement: BatchItem<'sqlite'> }

/**
 * Prepares a single setting write (cache bust, encrypt-if-sensitive, insert vs update
 * vs delete) WITHOUT executing it, so multiple keys can be folded into one db.batch()
 * call by batchSaveSettings() below instead of a separate D1 round trip per key.
 * Returns null when there's nothing to write (the SECRET_MASK "keep existing" case).
 */
async function prepareSettingWrite(event: H3Event, key: string, value: unknown): Promise<PreparedWrite | null> {
  const siteId = event.context.siteId as string
  if (!siteId) throw badRequest('Missing site ID in context')

  const rc = useRuntimeConfig()
  const db = useDb(event)

  // Clear memory cache entry
  settingsCache.delete(`${siteId}:${key}`)

  // Handle deletion if empty
  if (value === null || value === undefined || value === '') {
    return {
      statement: db.delete(siteSettings)
        .where(and(eq(siteSettings.siteId, siteId), eq(siteSettings.key, key))),
    }
  }

  // If sensitive setting, encrypt
  let finalValue = value
  if (SENSITIVE_SETTING_KEYS.has(key)) {
    if (typeof value !== 'string') {
      throw badRequest(`Sensitive setting ${key} must be a string`)
    }
    // If it's already the mask, do not update (keep existing)
    if (value === SECRET_MASK) {
      return null
    }
    const secret = rc.betterAuthSecret as string
    finalValue = await encryptText(value, secret)
  }

  const existing = await db.query.siteSettings.findFirst({
    where: and(eq(siteSettings.siteId, siteId), eq(siteSettings.key, key)),
  })

  if (existing) {
    return {
      statement: db.update(siteSettings)
        .set({ value: finalValue, updatedAt: sql`(datetime('now'))` })
        .where(and(eq(siteSettings.siteId, siteId), eq(siteSettings.key, key))),
    }
  }

  return {
    statement: db.insert(siteSettings).values({
      id: ulid(),
      siteId,
      key,
      value: finalValue,
    }),
  }
}

/**
 * Saves a setting for a site. Encrypts if marked sensitive.
 */
export async function saveSetting(event: H3Event, key: string, value: unknown): Promise<void> {
  const prepared = await prepareSettingWrite(event, key, value)
  if (prepared) await prepared.statement
}

/**
 * Saves multiple settings for a site as a single atomic D1 batch — either every key
 * lands or none do, and it's one D1 round trip instead of one (or two, counting the
 * existing-row lookup) per key. Prefer this over calling saveSetting() in a loop
 * whenever more than one key changes together (e.g. the admin settings save route),
 * so a transient failure partway through can't leave some keys saved and others not
 * while the audit log claims the whole batch changed.
 */
export async function batchSaveSettings(event: H3Event, entries: [string, unknown][]): Promise<void> {
  if (entries.length === 0) return

  // The per-key existing-row lookups are independent reads with nothing to race
  // against each other, so they run in parallel; only the resulting writes need to
  // land together atomically.
  const prepared = await Promise.all(entries.map(([key, value]) => prepareSettingWrite(event, key, value)))
  const statements = prepared
    .filter((p): p is PreparedWrite => p !== null)
    .map(p => p.statement)
  if (statements.length === 0) return

  const db = useDb(event)
  await db.batch(statements as [typeof statements[number], ...typeof statements])
}
