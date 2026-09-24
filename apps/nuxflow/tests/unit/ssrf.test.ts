import { describe, it, expect } from 'vitest'
import { isSafeUrl } from '../../server/utils/ssrf'

describe('SSRF Prevention (isSafeUrl)', () => {
  it('should allow safe public URLs', () => {
    expect(isSafeUrl('https://example.com')).toBe(true)
    expect(isSafeUrl('https://google.com/search?q=test')).toBe(true)
    expect(isSafeUrl('http://10-domain.com')).toBe(true) // Starts with 10 but is a domain name
    expect(isSafeUrl('https://github.com/nuxflow/app')).toBe(true)
  })

  it('should block local hostnames and endings', () => {
    expect(isSafeUrl('http://localhost')).toBe(false)
    expect(isSafeUrl('https://my-server.local')).toBe(false)
    expect(isSafeUrl('http://database.internal')).toBe(false)
  })

  it('should block private and loopback IPv4 addresses', () => {
    expect(isSafeUrl('http://127.0.0.1')).toBe(false)
    expect(isSafeUrl('http://0.0.0.0')).toBe(false)
    expect(isSafeUrl('https://10.0.0.1')).toBe(false)
    expect(isSafeUrl('https://192.168.1.1')).toBe(false)
    expect(isSafeUrl('http://172.16.5.9')).toBe(false)
    expect(isSafeUrl('https://169.254.169.254')).toBe(false)
  })

  it('should block private and loopback IPv6 addresses', () => {
    expect(isSafeUrl('http://[::1]')).toBe(false)
    expect(isSafeUrl('http://[::]')).toBe(false)
    expect(isSafeUrl('https://[fc00::1]')).toBe(false)
    expect(isSafeUrl('https://[fe80::1]')).toBe(false)
    expect(isSafeUrl('http://[::ffff:127.0.0.1]')).toBe(false)
    expect(isSafeUrl('http://[::ffff:10.0.0.5]')).toBe(false)
  })

  it('should block invalid protocols', () => {
    expect(isSafeUrl('ftp://example.com')).toBe(false)
    expect(isSafeUrl('file:///etc/passwd')).toBe(false)
    expect(isSafeUrl('javascript:alert(1)')).toBe(false)
  })
})
