import { accountsUrl, isCentralAuth, isAccountsHost } from '../utils/accounts-origin'

// Enforces the split described in utils/accounts-origin.ts once central sign-in is on.
//
// The accounts origin serves the sign-in pages and account-wide APIs only — no site
// content, admin, or site APIs — and is locked down like any identity provider: never
// framed, never indexed, never cached, and no Referer leaks (reset links carry tokens).
//
// A site's own domain serves no Better Auth endpoint at all, and its old sign-in page
// URLs forward to the accounts origin, so no password or reset token is ever handled
// where that site's own scripts run.

// Pages the accounts origin renders.
const ACCOUNTS_PAGES = ['/login', '/register', '/forgot-password', '/reset-password', '/account', '/authorize']
// APIs the accounts origin answers.
const ACCOUNTS_API_PREFIXES = [
  '/api/auth/',
  '/api/accounts/',
  '/api/v1/auth/session',
  '/api/v1/account/data-export',
  '/api/_nuxt_icon/',
  '/api/health',
]

function isAccountsPage(path: string): boolean {
  return ACCOUNTS_PAGES.some(p => path === p || path.startsWith(`${p}/`))
}

function isFrameworkAsset(path: string): boolean {
  // Nuxt's own bundles/payloads, and static files from public/ (favicon etc.).
  return path.startsWith('/_nuxt/') || path.startsWith('/__nuxt') || path.endsWith('/_payload.json') || /\.[a-z0-9]{2,5}$/i.test(path)
}

export default defineEventHandler((event) => {
  if (!isCentralAuth()) return
  const url = getRequestURL(event)
  const path = url.pathname.replace(/\/+$/, '') || '/'

  if (isAccountsHost(event)) {
    if (isFrameworkAsset(path)) return
    setResponseHeaders(event, {
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': 'frame-ancestors \'none\'',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow',
      'Cache-Control': 'no-store',
    })
    if (path === '/') return sendRedirect(event, '/account', 302)
    if (path === '/api/v1/account' && event.method === 'DELETE') return
    if (isAccountsPage(path) || ACCOUNTS_API_PREFIXES.some(p => path === p.replace(/\/$/, '') || path.startsWith(p))) return
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  // A site's own domain.
  if (path.startsWith('/api/auth/') || path === '/api/auth') {
    throw createError({ statusCode: 404, statusMessage: 'Sign-in happens on the accounts site' })
  }
  if (event.method !== 'GET') return
  const query = url.search
  switch (path) {
    case '/login': {
      const params = new URLSearchParams(query)
      const returnTo = params.get('redirect') ?? '/admin'
      return sendRedirect(event, `/_nuxflow/auth/start?${new URLSearchParams({ return_to: returnTo })}`, 302)
    }
    case '/register': {
      const returnTo = new URLSearchParams(query).get('redirect') ?? '/account'
      return sendRedirect(event, `/_nuxflow/auth/start?${new URLSearchParams({ return_to: returnTo, intent: 'join' })}`, 302)
    }
    case '/forgot-password':
    case '/reset-password':
      return sendRedirect(event, `${accountsUrl(path)}${query}`, 302)
  }
})
