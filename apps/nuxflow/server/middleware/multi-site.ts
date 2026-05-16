import { useDb } from '../utils/db'
import { sites } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  // Let setup & auth API paths through before touching the DB — the schema
  // may not exist yet (fresh install / wiped DB awaiting migrations).
  const path = event.path
  if (path.startsWith('/api/v1/setup') || path.startsWith('/api/auth') || path === '/api/health') {
    return
  }

  const host = getHeader(event, 'host')?.split(':')[0] ?? ''
  const db = useDb(event)

  let site: { id: string; status: string; setupCompleted: boolean } | undefined
  try {
    site = await db.query.sites.findFirst({
      where: eq(sites.domain, host),
      columns: { id: true, status: true, setupCompleted: true },
    })
  } catch {
    // DB not yet migrated — treat as no site so the setup guard can redirect.
    site = undefined
  }

  event.context.siteId = site?.id ?? null
  event.context.siteStatus = site?.status ?? null
  event.context.setupCompleted = site?.setupCompleted ?? false

  if (site?.status === 'maintenance' && !path.startsWith('/admin') && !path.startsWith('/api') && !path.startsWith('/_')) {
    setResponseStatus(event, 503)
    setHeader(event, 'Content-Type', 'text/html; charset=utf-8')
    return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Down for maintenance</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#0f172a;color:#f8fafc}
  .wrap{text-align:center;max-width:480px;padding:2.5rem 2rem}
  .icon{font-size:3rem;margin-bottom:1.5rem}
  h1{font-size:1.75rem;font-weight:700;letter-spacing:-.02em;margin-bottom:.75rem}
  p{color:#94a3b8;line-height:1.6;font-size:1rem}
</style>
</head>
<body>
  <div class="wrap">
    <div class="icon">🔧</div>
    <h1>Down for maintenance</h1>
    <p>We're making some improvements. We'll be back shortly — thank you for your patience.</p>
  </div>
</body>
</html>`
  }
})
