import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { SENSITIVE_SETTING_KEYS } from '../../server/utils/settings'

/**
 * Guard rail for a gap flagged in the pre-release audit: PATCH /api/v1/settings accepts
 * a fully free-form `settings: z.record(string, unknown)` map (see server/api/v1/settings/
 * index.patch.ts) with no allowlist on key names — nothing stops a future secret setting
 * from being added (a new provider's API key, say) without also adding it to
 * SENSITIVE_SETTING_KEYS in settings.ts, which would silently store it in plaintext.
 *
 * Rather than build a real allowlist (this settings map genuinely does hold many
 * legitimate non-secret keys — theme colors, feature toggles, etc. — enumerating all of
 * them would be its own maintenance burden), this statically scans every server-side
 * setting-key string literal for one that LOOKS like a credential by name and asserts
 * it's registered as sensitive. A key this pattern flags that's genuinely not secret
 * (the way push.vapid_public_key is — a deliberately public verification key) should be
 * added to PUBLIC_KEY_SHAPED_EXCEPTIONS below with a comment saying why, not silently
 * skipped. (payments.paddle_webhook_secret used to be such an exception under the name
 * payments.paddle_webhook_public_key — it was believed to be a public Ed25519
 * verification key, but Paddle actually signs webhooks with HMAC-SHA256 keyed by a
 * shared secret, so it was reclassified as sensitive instead of exempted here.)
 */

const SERVER_DIR = join(__dirname, '../../server')

// Matches this project's own settings-key convention throughout the codebase:
// lowercase.dot.separated.snake_case, e.g. 'ai.openai_api_key'.
const SETTING_KEY_LITERAL = /'(?<key>[a-z][a-z0-9]*(?:\.[a-z0-9_]+)+)'/g

// Name shapes that mean "this is a credential" — kept intentionally broad (a false
// positive here just means adding a one-line exception with a reason; a false negative
// means a real secret ships unencrypted).
const SECRET_NAME_PATTERN = /api_key|secret|token|auth_key|private_key|password|_key$/

// Keys that match SECRET_NAME_PATTERN by name but are deliberately NOT sensitive.
const PUBLIC_KEY_SHAPED_EXCEPTIONS = new Set([
  'push.vapid_public_key',
  // Cloudflare Turnstile's "site key" is the public widget key (same model as
  // reCAPTCHA's site key vs secret key) — meant to be embedded in frontend HTML, and
  // is in fact served straight to visitors by server/api/public/site.get.ts. The real
  // secret (CLOUDFLARE_TURNSTILE_SECRET_KEY) isn't a site setting at all — it's read
  // directly from process.env in server/utils/turnstile.ts.
  'integrations.turnstile_site_key',
  // Notification *type* names (server/utils/notify.ts's NOTIFICATION_TYPES), not setting
  // keys — they only share the dotted shape the literal scan above looks for.
  'security.api_key_created',
  'security.password_changed',
])

function collectTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      collectTsFiles(full, out)
    } else if (entry.endsWith('.ts')) {
      out.push(full)
    }
  }
  return out
}

function collectSettingKeyLiterals(): Set<string> {
  const keys = new Set<string>()
  for (const file of collectTsFiles(SERVER_DIR)) {
    const content = readFileSync(file, 'utf8')
    for (const match of content.matchAll(SETTING_KEY_LITERAL)) {
      keys.add(match.groups!.key!)
    }
  }
  return keys
}

describe('settings key allowlist guard rail', () => {
  it('every secret-shaped setting key referenced in server/ is in SENSITIVE_SETTING_KEYS', () => {
    const allKeys = collectSettingKeyLiterals()
    const secretShaped = [...allKeys].filter(k => SECRET_NAME_PATTERN.test(k) && !PUBLIC_KEY_SHAPED_EXCEPTIONS.has(k))
    const missing = secretShaped.filter(k => !SENSITIVE_SETTING_KEYS.has(k))

    expect(missing, `These setting keys look like credentials by name but aren't in SENSITIVE_SETTING_KEYS (server/utils/settings.ts) — they'd be stored in plaintext. Add them there, or to PUBLIC_KEY_SHAPED_EXCEPTIONS in this test if genuinely not secret: ${missing.join(', ')}`).toEqual([])
  })

  it('every PUBLIC_KEY_SHAPED_EXCEPTIONS entry is still actually referenced somewhere (no stale exceptions)', () => {
    const allKeys = collectSettingKeyLiterals()
    for (const key of PUBLIC_KEY_SHAPED_EXCEPTIONS) {
      expect(allKeys.has(key), `PUBLIC_KEY_SHAPED_EXCEPTIONS lists '${key}' but it's no longer referenced anywhere in server/ — remove the stale exception.`).toBe(true)
    }
  })
})
