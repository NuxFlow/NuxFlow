/**
 * The few Cloudflare for SaaS calls the hosting platform needs: register a customer's own
 * domain on the sites zone (e.g. nuxflow.site), read its status, and remove it.
 * https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/
 *
 * Certificates use HTTP validation: once the customer's CNAME points at our target,
 * Cloudflare validates the hostname and issues the certificate itself, with no
 * `/.well-known/` handling needed here. The API token needs the zone's
 * "SSL and Certificates: Edit" permission.
 */

export interface SaasConfig {
  zoneId: string
  apiToken: string
}

export interface CustomHostname {
  id: string
  hostname: string
  /** Hostname status: pending, active, moved, deleted, … */
  status: string
  /** Certificate status: initializing, pending_validation, pending_issuance, active, … */
  sslStatus: string | null
  /** Problems Cloudflare reports, in its own words. */
  errors: string[]
}

export class CloudflareApiError extends Error {
  constructor(message: string, readonly codes: number[] = []) {
    super(message)
    this.name = 'CloudflareApiError'
  }
}

/** Cloudflare's code for "a custom hostname with this name already exists". */
export const DUPLICATE_HOSTNAME_CODE = 1406

interface ApiHostname {
  id: string
  hostname: string
  status?: string
  ssl?: { status?: string, validation_errors?: { message?: string }[] }
  verification_errors?: string[]
}

async function call<T>(cfg: SaasConfig, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(cfg.zoneId)}/custom_hostnames${path}`, {
    method,
    headers: { 'authorization': `Bearer ${cfg.apiToken}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let json: { success?: boolean, result?: T, errors?: { code: number, message: string }[] }
  try {
    json = await res.json() as typeof json
  }
  catch {
    throw new CloudflareApiError(`Cloudflare answered ${res.status} with no readable body.`)
  }
  if (!res.ok || !json.success) {
    const errors = json.errors ?? []
    throw new CloudflareApiError(errors.map(e => e.message).join('; ') || `Cloudflare answered ${res.status}.`, errors.map(e => e.code))
  }
  return json.result as T
}

function toHostname(r: ApiHostname): CustomHostname {
  return {
    id: r.id,
    hostname: r.hostname,
    status: r.status ?? 'pending',
    sslStatus: r.ssl?.status ?? null,
    errors: [
      ...(r.verification_errors ?? []),
      ...(r.ssl?.validation_errors ?? []).map(e => e.message ?? '').filter(Boolean),
    ],
  }
}

export async function createCustomHostname(cfg: SaasConfig, hostname: string): Promise<CustomHostname> {
  return toHostname(await call<ApiHostname>(cfg, 'POST', '', { hostname, ssl: { method: 'http', type: 'dv' } }))
}

export async function getCustomHostname(cfg: SaasConfig, id: string): Promise<CustomHostname> {
  return toHostname(await call<ApiHostname>(cfg, 'GET', `/${encodeURIComponent(id)}`))
}

/** Removes a custom hostname; one that's already gone counts as removed. */
export async function deleteCustomHostname(cfg: SaasConfig, id: string): Promise<void> {
  try {
    await call(cfg, 'DELETE', `/${encodeURIComponent(id)}`)
  }
  catch (err) {
    if (err instanceof CloudflareApiError && /not found|does not exist/i.test(err.message)) return
    throw err
  }
}

/** Both the hostname and its certificate are live. */
export function isLive(h: Pick<CustomHostname, 'status' | 'sslStatus'>): boolean {
  return h.status === 'active' && h.sslStatus === 'active'
}
