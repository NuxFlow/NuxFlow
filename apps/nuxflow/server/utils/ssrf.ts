import { URL } from 'node:url'

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
