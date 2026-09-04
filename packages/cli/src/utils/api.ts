export async function authenticate(site: string, email: string, password: string): Promise<string> {
  const res = await fetch(`${site}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Origin': site },
    body: JSON.stringify({ email, password, rememberMe: false }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Authentication failed (${res.status}): ${text || res.statusText}`)
  }

  const setCookie = res.headers.get('set-cookie')
  if (!setCookie) throw new Error('No session cookie returned — check your email and password')

  // Return only the name=value pair (strip attributes like Path, HttpOnly, etc.)
  return setCookie.split(';')[0]!
}

async function request(method: string, site: string, path: string, cookie: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${site}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookie,
      'Origin': site,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })

  // Allow 404 on DELETE — treat as success (already gone)
  if (method === 'DELETE' && res.status === 404) return {}

  const data = await res.json().catch(() => ({ error: res.statusText })) as Record<string, unknown>

  if (!res.ok) {
    const msg = (data.message ?? data.error ?? res.statusText) as string
    throw new Error(`API error (${res.status}): ${msg}`)
  }

  return data
}

export const apiPost   = (site: string, path: string, cookie: string, body: unknown) => request('POST',   site, path, cookie, body)
export const apiPatch  = (site: string, path: string, cookie: string, body: unknown) => request('PATCH',  site, path, cookie, body)
export const apiDelete = (site: string, path: string, cookie: string)                => request('DELETE', site, path, cookie)

export async function apiPostZip(site: string, path: string, cookie: string, filename: string, data: Uint8Array): Promise<unknown> {
  const form = new FormData()
  form.append('file', new Blob([data as unknown as BlobPart]), filename)

  const res = await fetch(`${site}${path}`, {
    method: 'POST',
    headers: { 'Cookie': cookie, 'Origin': site },
    body: form,
  })

  const data2 = await res.json().catch(() => ({ error: res.statusText })) as Record<string, unknown>

  if (!res.ok) {
    const msg = (data2.message ?? data2.error ?? res.statusText) as string
    throw new Error(`API error (${res.status}): ${msg}`)
  }

  return data2
}

const LOCAL_HTTP_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

export function resolveAuth(opts: Record<string, unknown>) {
  const site = ((opts.site as string | undefined) ?? process.env.NUXFLOW_SITE ?? '').replace(/\/$/, '')
  const email = (opts.email as string | undefined) ?? process.env.NUXFLOW_EMAIL ?? ''
  const password = (opts.password as string | undefined) ?? process.env.NUXFLOW_PASSWORD ?? ''

  if (!site)     throw new Error('--site is required (or set NUXFLOW_SITE)')
  if (!email)    throw new Error('--email is required (or set NUXFLOW_EMAIL)')
  if (!password) throw new Error('--password is required (or set NUXFLOW_PASSWORD)')

  // authenticate()/request() send the admin email/password and session cookie in the
  // clear over whatever scheme `site` uses — reject plain http:// (except an explicit
  // localhost/loopback target, the normal case for local dev against `wrangler dev`)
  // rather than silently leaking credentials to anyone on the network path.
  let parsed: URL
  try {
    parsed = new URL(site)
  } catch {
    throw new Error(`--site must be a valid URL: ${site}`)
  }
  if (parsed.protocol !== 'https:' && !LOCAL_HTTP_HOSTS.has(parsed.hostname)) {
    throw new Error(`--site must use https:// (got ${parsed.protocol}//${parsed.hostname}) — refusing to send credentials over an insecure connection`)
  }

  return { site, email, password }
}
