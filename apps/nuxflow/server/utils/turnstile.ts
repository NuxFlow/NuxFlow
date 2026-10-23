const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const SITEVERIFY_TIMEOUT_MS = 10_000

/**
 * The deployment's Turnstile secret (`wrangler secret put CLOUDFLARE_TURNSTILE_SECRET_KEY`),
 * or null when Turnstile isn't set up. The one place it's read, so forms, sign-in and the
 * setup checklist can't disagree about whether it exists.
 */
export function getTurnstileSecret(): string | null {
  return process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY || null
}

/**
 * Checks a Turnstile token with Cloudflare. Turnstile is opt-in: with no secret configured
 * there's nothing to check against, so every token passes (the setup checklist flags a
 * site key without a secret). Once it is configured, anything short of a clear
 * `success: true` — an error page, a timeout, a network failure — counts as a failed check.
 */
export async function verifyTurnstile(token: string, ip?: string): Promise<boolean> {
  const secret = getTurnstileSecret()
  if (!secret) return true

  const fd = new FormData()
  fd.append('secret', secret)
  fd.append('response', token)
  if (ip) fd.append('remoteip', ip)

  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      body: fd,
      signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
    })
    if (!res.ok) {
      console.error(`[turnstile] siteverify answered ${res.status}`)
      return false
    }
    const json = await res.json() as { success?: boolean }
    return json.success === true
  } catch (err) {
    console.error('[turnstile] siteverify failed', err)
    return false
  }
}
