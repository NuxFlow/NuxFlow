import { getCfBindings } from '../../../utils/cf-env'

// Serves MEDIA_BUCKET objects through this Worker — the zero-config R2 path (see the
// binding-only branch in getActiveProvider). Used when a site has the R2 binding but no
// public bucket URL configured; with a public URL, media is served straight from R2 and
// this route is never linked to.

// Media uploads are keyed `<siteId>/<ULID>.<ext>` (upload.post.ts) and never rewritten in
// place, so they can be cached forever. Anything else in the bucket (theme assets under
// `<siteId>/themes/...`, which a re-import can overwrite) gets a short cache instead.
const IMMUTABLE_UPLOAD_KEY = /^[^/]+\/[0-9A-HJKMNP-TV-Z]{26}\.[a-z0-9]{1,10}$/i

function decodeKey(raw: string): string | null {
  try {
    return raw.split('/').map(decodeURIComponent).join('/')
  } catch {
    return null
  }
}

export default defineEventHandler(async (event) => {
  if (event.method !== 'GET' && event.method !== 'HEAD') {
    setHeader(event, 'Allow', 'GET, HEAD')
    throw createError({ statusCode: 405, message: 'Method not allowed' })
  }

  const siteId = event.context.siteId as string | null
  const key = decodeKey(getRouterParam(event, 'key') ?? '')
  // Tenant isolation: a site's domain only ever serves that site's own objects, and no
  // path-traversal-shaped key is ever handed to the bucket.
  if (!siteId || !key || !key.startsWith(`${siteId}/`) || key.split('/').some(seg => seg === '' || seg === '.' || seg === '..')) {
    throw notFound('Not found')
  }

  const { r2 } = getCfBindings(event)
  if (!r2) throw notFound('Not found')

  const requestHeaders = new Headers()
  for (const [name, value] of Object.entries(getHeaders(event))) {
    if (value !== undefined) requestHeaders.set(name, value)
  }

  // onlyIf honours If-None-Match/If-Modified-Since (a failed precondition returns the
  // object without a body → 304); range honours Range for audio/video seeking.
  const object = await r2.get(key, { onlyIf: requestHeaders, range: requestHeaders })
  if (!object) throw notFound('Not found')

  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('ETag', object.httpEtag)
  headers.set('Accept-Ranges', 'bytes')
  headers.set('Cache-Control', IMMUTABLE_UPLOAD_KEY.test(key)
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=300')
  // Served from the site's own origin, so the response must never be able to act as a
  // page on it: an opaque-origin sandbox + no MIME sniffing makes even a sanitizer-missed
  // SVG inert when opened directly (SVGs also carry Content-Disposition: attachment from
  // their upload metadata). <img>/<video>/CSS embedding ignores both headers.
  headers.set('Content-Security-Policy', 'sandbox; default-src \'none\'; style-src \'unsafe-inline\'')
  headers.set('X-Content-Type-Options', 'nosniff')

  if (!('body' in object)) {
    return new Response(null, { status: 304, headers })
  }

  let status = 200
  const range = object.range as { offset?: number; length?: number; suffix?: number } | undefined
  if (range && requestHeaders.has('range')) {
    const offset = range.suffix !== undefined ? object.size - range.suffix : (range.offset ?? 0)
    const length = range.length ?? object.size - offset
    headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${object.size}`)
    headers.set('Content-Length', String(length))
    status = 206
  } else {
    headers.set('Content-Length', String(object.size))
  }

  return new Response(event.method === 'HEAD' ? null : object.body, { status, headers })
})
