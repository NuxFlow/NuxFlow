// Baseline response headers for every request (server/middleware/03.security-headers.ts).
// The stricter per-surface headers set elsewhere — the accounts origin's DENY/no-referrer
// (03.accounts-routing.ts), media and plugin responses' CSP sandbox — always win: this
// only fills in what nothing else has set.

/**
 * Screens that act on the signed-in user's behalf. Framing is limited to the same origin
 * there so another page can't overlay them for clickjacking — including a tenant on a
 * sibling subdomain of the same registrable domain, whose requests are "same-site" and so
 * carry SameSite=Lax session cookies into a frame. Public pages stay embeddable.
 */
const FRAME_PROTECTED_PREFIXES = [
  '/admin', '/account', '/setup', '/login', '/register', '/forgot-password',
  '/reset-password', '/authorize', '/_nuxflow/auth/',
]

export function isFrameProtectedPath(path: string): boolean {
  return FRAME_PROTECTED_PREFIXES.some(p => path === p || path.startsWith(p.endsWith('/') ? p : `${p}/`))
}

/** Headers to add for `path`, skipping any name `existing` already has (case-insensitive). */
export function baselineSecurityHeaders(path: string, existing: (name: string) => unknown): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  }
  if (isFrameProtectedPath(path)) {
    headers['X-Frame-Options'] = 'SAMEORIGIN'
    headers['Content-Security-Policy'] = 'frame-ancestors \'self\''
  }
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => existing(name) === undefined || existing(name) === null),
  )
}
