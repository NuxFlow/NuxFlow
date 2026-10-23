import type { H3Event } from 'h3'

/**
 * The visitor's IP address, or null when there's none to read. Cloudflare sets
 * `cf-connecting-ip` on every request that reaches the Worker, and a client can't override
 * it. `x-forwarded-for` is only consulted when that header is missing (local tooling); it's
 * client-controlled, so it never wins over Cloudflare's value.
 */
export function getClientIp(event: H3Event): string | null {
  const cfIp = getHeader(event, 'cf-connecting-ip')
  if (cfIp) return cfIp
  return getHeader(event, 'x-forwarded-for')?.split(',')[0]?.trim() || null
}
