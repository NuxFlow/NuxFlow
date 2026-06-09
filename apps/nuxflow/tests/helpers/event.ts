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

export interface MockEventOptions {
  siteId?: string
  session?: MockSession | null
  body?: unknown
  query?: Record<string, string>
  headers?: Record<string, string>
  params?: Record<string, string>
  path?: string
  apiKeyUserId?: string
}

export function createMockEvent(opts: MockEventOptions = {}) {
  return {
    context: {
      siteId: opts.siteId ?? 'site-test-01',
      _session: opts.session ?? null,
      apiKeyUserId: opts.apiKeyUserId,
      setupCompleted: true,
      siteStatus: 'active' as const,
    },
    _body: opts.body,
    _query: opts.query ?? {},
    _headers: opts.headers ?? {},
    _params: opts.params ?? {},
    _path: opts.path ?? '/',
    _responseHeaders: {} as Record<string, string | string[]>,
    _status: undefined as number | undefined,
    _redirect: undefined as { url: string; code: number } | undefined,
  }
}

export type MockEvent = ReturnType<typeof createMockEvent>
