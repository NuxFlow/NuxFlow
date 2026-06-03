import { describe, it, expect } from 'vitest'
import { isSafeUrl, validateZipArchive } from '../../server/utils/security'
import { zipSync } from 'fflate'

// Mock h3's createError global since it runs in Nuxt/h3 context
// We define a simple mock implementation if not available globally.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
if (!(globalThis as any).createError) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).createError = (err: { statusCode: number; message: string }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const error = new Error(err.message) as any
    error.statusCode = err.statusCode
    return error
  }
}

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

describe('ZIP Validation (validateZipArchive)', () => {
  it('should pass on a valid zip file and return metadata', () => {
    const zipBytes = zipSync({
      'theme.css': new TextEncoder().encode('body { color: red; }'),
      'theme.json': new TextEncoder().encode('{"name": "test"}'),
    })

    const meta = validateZipArchive(zipBytes, 1000)
    expect(meta.fileCount).toBe(2)
    expect(meta.totalSize).toBeGreaterThan(0)
  })

  it('should fail if uncompressed size exceeds limit (Zip Bomb)', () => {
    const zipBytes = zipSync({
      'large.txt': new Uint8Array(1000),
    })

    expect(() => validateZipArchive(zipBytes, 500)).toThrow(/Decompression limit exceeded/)
  })

  it('should fail on directory traversal entries (Zip Slip)', () => {
    const zipBytes1 = zipSync({
      '../evil.css': new TextEncoder().encode('body {}'),
    })
    expect(() => validateZipArchive(zipBytes1, 1000)).toThrow(/Directory traversal/)

    const zipBytes2 = zipSync({
      '/absolute.css': new TextEncoder().encode('body {}'),
    })
    expect(() => validateZipArchive(zipBytes2, 1000)).toThrow(/Directory traversal/)

    const zipBytes3 = zipSync({
      'C:/windows.css': new TextEncoder().encode('body {}'),
    })
    expect(() => validateZipArchive(zipBytes3, 1000)).toThrow(/Directory traversal/)
  })
})
