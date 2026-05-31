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

export function resolveAuth(opts: Record<string, unknown>) {
  const site = ((opts.site as string | undefined) ?? process.env.NUXFLOW_SITE ?? '').replace(/\/$/, '')
  const email = (opts.email as string | undefined) ?? process.env.NUXFLOW_EMAIL ?? ''
  const password = (opts.password as string | undefined) ?? process.env.NUXFLOW_PASSWORD ?? ''

  if (!site)     throw new Error('--site is required (or set NUXFLOW_SITE)')
  if (!email)    throw new Error('--email is required (or set NUXFLOW_EMAIL)')
  if (!password) throw new Error('--password is required (or set NUXFLOW_PASSWORD)')

  return { site, email, password }
}
