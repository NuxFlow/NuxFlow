/**
 * Factory for minimal fake H3Events used in integration tests.
 * The shape matches what our server utilities expect from the event object:
 * - event.context.siteId
 * - event.context._session  (for getUserSession / requireUserSession mocks)
 * - event.context.apiKeyUserId
 * - event._body, _query, _headers, _params, _path
 */

export interface MockSession {
  user: {
    id: string
    name: string
    email: string
  }
}

// Mirrors h3's MultiPartData shape closely enough for readMultipartFormData()'s stub
// in globals.ts — real h3 gives `data` as a Buffer, but any Uint8Array-like value
// works since every consumer in this codebase only reads .byteLength/.length/indices
// off of it (fflate's unzipSync, TextDecoder.decode, etc).
export interface MockMultipartEntry {
  name?: string
  filename?: string
  type?: string
  data: Uint8Array
}

export interface MockEventOptions {
  siteId?: string
  session?: MockSession | null
  body?: unknown
  rawBody?: string
  query?: Record<string, string>
  headers?: Record<string, string>
  params?: Record<string, string>
  path?: string
  apiKeyUserId?: string
  apiKeyRole?: string
  cookies?: Record<string, string>
  method?: string
  // Backs the readMultipartFormData() stub — routes using multipart/form-data
  // uploads (restore.post.ts, wordpress.post.ts, themes/index.post.ts).
  multipartFormData?: MockMultipartEntry[]
  // Backs the readFormData() stub — routes using the native Web FormData API
  // (media/upload.post.ts). Pass a real FormData instance.
  formData?: FormData
}

export function createMockEvent(opts: MockEventOptions = {}) {
  return {
    context: {
      siteId: opts.siteId ?? 'site-test-01',
      _session: opts.session ?? null,
      apiKeyUserId: opts.apiKeyUserId,
      apiKeyRole: opts.apiKeyRole,
      setupCompleted: true,
      siteStatus: 'active' as const,
    },
    _body: opts.body,
    _rawBody: opts.rawBody,
    _query: opts.query ?? {},
    _headers: opts.headers ?? {},
    _params: opts.params ?? {},
    _path: opts.path ?? '/',
    _method: opts.method ?? 'GET',
    _responseHeaders: {} as Record<string, string | string[]>,
    _status: undefined as number | undefined,
    _redirect: undefined as { url: string; code: number } | undefined,
    _cookies: { ...opts.cookies } as Record<string, string>,
    _multipartFormData: opts.multipartFormData,
    _formData: opts.formData,
  }
}

export type MockEvent = ReturnType<typeof createMockEvent>
