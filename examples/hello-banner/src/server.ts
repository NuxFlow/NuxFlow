// Server-side Cloudflare Worker for the "Hello Banner" plugin.
// NuxFlow routes /_nuxflow/ext/hello-banner/* to this handler (prefix already stripped).

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // GET /status — health check / plugin info
    if (request.method === 'GET' && url.pathname === '/status') {
      return Response.json({
        plugin: 'hello-banner',
        version: '0.1.0',
        status: 'ok',
        timestamp: new Date().toISOString(),
      })
    }

    // GET /message?name=World — personalised greeting
    if (request.method === 'GET' && url.pathname === '/message') {
      const name = url.searchParams.get('name') || 'World'
      return Response.json({ message: `Hello, ${name}! This response came from a Dynamic Worker.` })
    }

    return new Response('Not found', { status: 404 })
  },
}
