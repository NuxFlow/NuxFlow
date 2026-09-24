import { describe, it, expect } from 'vitest'
import { validateZipArchive } from '../../server/utils/zip-validate'
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
