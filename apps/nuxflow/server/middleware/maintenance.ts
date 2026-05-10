export default defineEventHandler((event) => {
  const path = event.path
  if (path.startsWith('/api') || path.startsWith('/admin') || path.startsWith('/_')) return

  if (event.context.siteStatus === 'maintenance') {
    setResponseStatus(event, 503)
    setHeader(event, 'Content-Type', 'text/html')
    return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Maintenance</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f9fafb}
.box{text-align:center;max-width:400px;padding:2rem}h1{font-size:1.5rem;font-weight:700;color:#111}p{color:#6b7280;margin-top:.5rem}</style>
</head><body><div class="box"><h1>Down for maintenance</h1><p>We'll be back soon. Thank you for your patience.</p></div></body></html>`
  }
})
