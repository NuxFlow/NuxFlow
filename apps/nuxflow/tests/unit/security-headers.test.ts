import { describe, it, expect } from 'vitest'
import { baselineSecurityHeaders, isFrameProtectedPath } from '../../server/utils/security-headers'

const none = () => undefined

describe('isFrameProtectedPath', () => {
  it.each(['/admin', '/admin/content/1', '/account', '/setup', '/login', '/reset-password', '/authorize', '/_nuxflow/auth/callback'])(
    'protects %s', path => expect(isFrameProtectedPath(path)).toBe(true),
  )

  it.each(['/', '/about', '/administrators-guide', '/accountability', '/blog/login-tips', '/_nuxflow/media/x.png'])(
    'leaves %s embeddable', path => expect(isFrameProtectedPath(path)).toBe(false),
  )
})

describe('baselineSecurityHeaders', () => {
  it('sends nosniff and a referrer policy everywhere, but no frame restriction on public pages', () => {
    expect(baselineSecurityHeaders('/about', none)).toEqual({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    })
  })

  it('limits framing to the same origin on admin and sign-in screens', () => {
    expect(baselineSecurityHeaders('/admin/settings', none)).toMatchObject({
      'X-Frame-Options': 'SAMEORIGIN',
      'Content-Security-Policy': 'frame-ancestors \'self\'',
    })
  })

  it('never overrides a stricter header an earlier middleware already set', () => {
    const existing: Record<string, string> = { 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' }
    const headers = baselineSecurityHeaders('/login', name => existing[name.toLowerCase()])
    expect(headers).not.toHaveProperty('X-Frame-Options')
    expect(headers).not.toHaveProperty('Referrer-Policy')
    expect(headers['X-Content-Type-Options']).toBe('nosniff')
  })
})
