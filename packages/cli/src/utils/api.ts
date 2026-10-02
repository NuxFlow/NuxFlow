import type { spinner } from '@clack/prompts'
import { consola } from 'consola'

// Every call authenticates with an API key (Admin → Settings → API keys, with the
// `manage:plugins` / `manage:themes` permission) sent as a Bearer token. The CLI used to
// sign in with an email and password instead, which can't work on a site's own domain
// once central sign-in is on: passwords are only ever accepted on the accounts origin.

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return await res.json().catch(() => ({ error: res.statusText })) as Record<string, unknown>
}

function apiError(res: Response, data: Record<string, unknown>): Error {
  const msg = (data.message ?? data.error ?? res.statusText) as string
  if (res.status === 401 || res.status === 403) {
    return new Error(`API error (${res.status}): ${msg} — check the API key is for this site, has the right permission, and belongs to an admin`)
  }
  return new Error(`API error (${res.status}): ${msg}`)
}

async function request(method: string, site: string, path: string, apiKey: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${site}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })

  // Allow 404 on DELETE — treat as success (already gone)
  if (method === 'DELETE' && res.status === 404) return {}

  const data = await readJson(res)
  if (!res.ok) throw apiError(res, data)
  return data
}

export const apiPost   = (site: string, path: string, apiKey: string, body: unknown) => request('POST',   site, path, apiKey, body)
export const apiPatch  = (site: string, path: string, apiKey: string, body: unknown) => request('PATCH',  site, path, apiKey, body)
export const apiDelete = (site: string, path: string, apiKey: string)                => request('DELETE', site, path, apiKey)

export async function apiPostZip(site: string, path: string, apiKey: string, filename: string, data: Uint8Array): Promise<unknown> {
  const form = new FormData()
  form.append('file', new Blob([data as unknown as BlobPart]), filename)

  const res = await fetch(`${site}${path}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: form,
  })

  const json = await readJson(res)
  if (!res.ok) throw apiError(res, json)
  return json
}

const LOCAL_HTTP_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

export function resolveAuth(opts: Record<string, unknown>) {
  const site = ((opts.site as string | undefined) ?? process.env.NUXFLOW_SITE ?? '').replace(/\/$/, '')
  const apiKey = (opts['api-key'] as string | undefined) ?? (opts.apiKey as string | undefined) ?? process.env.NUXFLOW_API_KEY ?? ''

  if (!site)   throw new Error('--site is required (or set NUXFLOW_SITE)')
  if (!apiKey) throw new Error('--api-key is required (or set NUXFLOW_API_KEY). Create one in Admin → Settings → API keys with the "Install and remove plugins" or "Upload and update themes" permission.')

  // The API key travels in a header on every request — reject plain http:// (except an
  // explicit localhost/loopback target, the normal case for local dev against
  // `wrangler dev`) rather than leaking it to anyone on the network path.
  let parsed: URL
  try {
    parsed = new URL(site)
  } catch {
    throw new Error(`--site must be a valid URL: ${site}`)
  }
  if (parsed.protocol !== 'https:' && !LOCAL_HTTP_HOSTS.has(parsed.hostname)) {
    throw new Error(`--site must use https:// (got ${parsed.protocol}//${parsed.hostname}) — refusing to send credentials over an insecure connection`)
  }

  return { site, apiKey }
}

/**
 * Shared `--site`/`--api-key` arg definitions for citty commands that talk to a live
 * site (`plugin deploy`/`update`, `theme deploy`/`update`). Spread into each command's
 * own `args` object. Prefer the env var for the key so it stays out of shell history.
 */
export const AUTH_ARGS = {
  'site':    { type: 'string', description: 'Site URL                          (or NUXFLOW_SITE)' },
  'api-key': { type: 'string', description: 'API key from Settings → API keys  (or NUXFLOW_API_KEY)' },
} as const

/**
 * Resolves the site and API key from CLI args/env, stopping the given spinner and
 * exiting the process with a friendly error when either is missing or unsafe.
 */
export function authenticateOrExit(
  s: ReturnType<typeof spinner>,
  args: Record<string, unknown>,
): { site: string, apiKey: string } {
  try {
    return resolveAuth(args)
  } catch (e: unknown) {
    s.stop('Auth failed.')
    consola.error((e as Error).message)
    process.exit(1)
  }
}
