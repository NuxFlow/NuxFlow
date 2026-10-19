// Outbound network policy for dynamic plugins. A plugin's fetch() never leaves the Worker
// directly: its `globalOutbound` is PluginEgressGateway (plugin-host/entrypoints.ts),
// which runs this for every request. Only HTTPS to a host the admin approved as a
// `network:<host>` permission gets through; everything else gets a 403 the plugin can see.
import { isSafeUrl } from './ssrf'
import { hostMatches } from '../../shared/lib/plugin-permissions'

export interface PluginEgressProps {
  siteId: string
  pluginId: string
  /** Approved `network:` hosts (exact names or `*.example.com`). */
  allowedHosts: string[]
  /**
   * Never reachable even if allowlisted: this site's own domain and the accounts domain.
   * A plugin calling back into the platform would act as an anonymous visitor at best,
   * and loops through /_nuxflow/ext at worst.
   */
  blockedHosts: string[]
}

/** Why `url` may not be fetched under `props`, or null when it may. */
export function egressBlockReason(url: URL, props: PluginEgressProps): string | null {
  if (url.protocol !== 'https:') return 'only https:// requests are allowed'
  if (url.port && url.port !== '443') return 'only the default HTTPS port is allowed'
  if (url.username || url.password) return 'credentials in the URL are not allowed'
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (props.blockedHosts.some(b => b.toLowerCase() === host)) return `${host} is this site's own address`
  if (!props.allowedHosts.some(p => hostMatches(p, host))) return `${host} is not in this plugin's approved network permissions`
  if (!isSafeUrl(url.href)) return `${host} is not a public address`
  return null
}

export async function egressFetch(request: Request, props: PluginEgressProps): Promise<Response> {
  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    return blocked('invalid URL')
  }
  const reason = egressBlockReason(url, props)
  if (reason) return blocked(reason)
  // Redirects are handed back to the plugin rather than followed here: following one would
  // reach a host nobody approved. If the plugin's own fetch follows it, that next request
  // comes back through this gateway and is checked like any other.
  return fetch(new Request(request, { redirect: 'manual' }))
}

function blocked(reason: string): Response {
  return new Response(`Blocked by NuxFlow: ${reason}`, {
    status: 403,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'x-nuxflow-egress': 'blocked' },
  })
}
