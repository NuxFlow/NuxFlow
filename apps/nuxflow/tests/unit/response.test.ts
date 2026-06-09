import { describe, it, expect } from 'vitest'
import type { H3Event } from 'h3'
import { ok, created, noContent, notFound, unauthorized, forbidden, conflict, validationError } from '../../server/utils/response'

// Auto-import mocks
;(globalThis as Record<string, unknown>).createError = (opts: { statusCode?: number; message?: string; data?: unknown }) => {
  const err = new Error(opts.message ?? 'Error') as Error & { statusCode: number; data: unknown }
  err.statusCode = opts.statusCode ?? 500
  err.data = opts.data
  return err
}
;(globalThis as Record<string, unknown>).setResponseStatus = (event: Record<string, unknown>, status: number) => {
  ;(event as { _status?: number })._status = status
}

function mkEvent() {
  return { _status: undefined as number | undefined } as unknown as H3Event
}

describe('ok', () => {
  it('returns the data as-is', () => {
    const result = ok({ id: 1, name: 'test' })
    expect(result).toEqual({ id: 1, name: 'test' })
  })

  it('works with primitives', () => {
    expect(ok(42)).toBe(42)
    expect(ok('hello')).toBe('hello')
    expect(ok(null)).toBe(null)
  })
})

describe('created', () => {
  it('sets response status to 201 and returns the data', () => {
    const event = mkEvent()
    const data = { id: 'new-resource' }
    const result = created(event, data)
    expect(result).toEqual(data)
    expect(event._status).toBe(201)
  })
})

describe('noContent', () => {
  it('sets response status to 204 and returns null', () => {
    const event = mkEvent()
    const result = noContent(event)
    expect(result).toBe(null)
    expect(event._status).toBe(204)
  })
})

describe('notFound', () => {
  it('throws an error with status 404', () => {
    expect(() => notFound()).toThrowError()
    try { notFound() } catch (e) { expect((e as { statusCode: number }).statusCode).toBe(404) }
  })

  it('uses the default message', () => {
    try { notFound() } catch (e) { expect((e as Error).message).toBe('Not found') }
  })

  it('uses a custom message', () => {
    try { notFound('User not found') } catch (e) { expect((e as Error).message).toBe('User not found') }
  })
})

describe('unauthorized', () => {
  it('throws 401', () => {
    try { unauthorized() } catch (e) { expect((e as { statusCode: number }).statusCode).toBe(401) }
  })
})

describe('forbidden', () => {
  it('throws 403', () => {
    try { forbidden() } catch (e) { expect((e as { statusCode: number }).statusCode).toBe(403) }
  })

  it('uses a custom message', () => {
    try { forbidden('No access') } catch (e) { expect((e as Error).message).toBe('No access') }
  })
})

describe('conflict', () => {
  it('throws 409', () => {
    try { conflict() } catch (e) { expect((e as { statusCode: number }).statusCode).toBe(409) }
  })
})

describe('validationError', () => {
  it('throws 422 with data', () => {
    const issues = { field: ['required'] }
    try { validationError('Bad input', issues) } catch (e) {
      expect((e as { statusCode: number }).statusCode).toBe(422)
      expect((e as { data: unknown }).data).toEqual(issues)
    }
  })
})
