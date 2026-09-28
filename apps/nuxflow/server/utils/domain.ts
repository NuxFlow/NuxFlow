// A site's domain is matched byte-for-byte against the request's Host header
// (02.multi-site.ts), which the runtime always delivers lower-cased, punycoded, without
// scheme, path, port or trailing dot. A domain stored as "Example.com",
// "https://example.com/" or with a stray space never resolves, silently — so every write
// path normalizes through here first.

// RFC 1123 labels: 1–63 chars of [a-z0-9-], not starting/ending with '-'.
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/**
 * Returns the canonical host form of `input`, or null when it isn't a usable hostname.
 * Accepts a pasted URL (`https://Example.com/path` → `example.com`) and converts an
 * internationalized name to punycode, as the Host header carries it. Ports are dropped —
 * site resolution ignores the port too, so local `wrangler dev` stores plain `localhost`.
 */
export function normalizeDomain(input: string): string | null {
  const value = input.trim()
  if (!value) return null
  let host: string
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`).hostname
  } catch {
    return null
  }
  host = host.replace(/\.$/, '')
  if (host === 'localhost') return host

  const labels = host.split('.')
  if (labels.length < 2 || !labels.every(l => LABEL.test(l))) return null
  return host
}
