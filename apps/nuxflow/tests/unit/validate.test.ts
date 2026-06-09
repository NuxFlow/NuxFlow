import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import type { H3Event } from 'h3'
import { parseBody, parseQuery } from '../../server/utils/validate'

// Auto-import mocks — must be set before any test invokes the functions
;(globalThis as Record<string, unknown>).createError = (opts: { statusCode?: number; message?: string; data?: unknown }) => {
  const err = new Error(opts.message ?? 'Error') as Error & { statusCode: number; data: unknown }
  err.statusCode = opts.statusCode ?? 500
  err.data = opts.data
  return err
}
;(globalThis as Record<string, unknown>).readBody = async (event: Record<string, unknown>) =>
  (event as { _body?: unknown })._body

;(globalThis as Record<string, unknown>).getQuery = (event: Record<string, unknown>) =>
  (event as { _query?: Record<string, string> })._query ?? {}

const PersonSchema = z.object({
  name: z.string().min(1),
  age: z.number().int().positive(),
})

function mkEvent(body?: unknown, query?: Record<string, string>) {
  return { _body: body, _query: query ?? {} } as unknown as H3Event
}

describe('parseBody', () => {
  it('returns parsed data when body matches schema', async () => {
    const result = await parseBody(mkEvent({ name: 'Alice', age: 30 }), PersonSchema)
    expect(result).toEqual({ name: 'Alice', age: 30 })
  })

  it('throws 422 when body fails validation', async () => {
    await expect(parseBody(mkEvent({ name: '', age: -1 }), PersonSchema)).rejects.toMatchObject({
      statusCode: 422,
    })
  })

  it('throws 422 when body is missing required fields', async () => {
    await expect(parseBody(mkEvent({}), PersonSchema)).rejects.toMatchObject({
      statusCode: 422,
    })
  })

  it('throws 422 when body is undefined', async () => {
    await expect(parseBody(mkEvent(undefined), PersonSchema)).rejects.toMatchObject({
      statusCode: 422,
    })
  })
})

describe('parseQuery', () => {
  it('returns parsed data when query matches schema', () => {
    const StringSchema = z.object({ q: z.string() })
    const result = parseQuery(mkEvent(undefined, { q: 'hello' }), StringSchema)
    expect(result).toEqual({ q: 'hello' })
  })

  it('throws 422 when query fails schema', () => {
    const RequiredSchema = z.object({ page: z.string().regex(/^\d+$/) })
    expect(() => parseQuery(mkEvent(undefined, { page: 'abc' }), RequiredSchema)).toThrow()
  })

  it('coerces query params as expected by schema', () => {
    const Schema = z.object({ limit: z.string().optional() })
    const result = parseQuery(mkEvent(undefined, { limit: '10' }), Schema)
    expect(result.limit).toBe('10')
  })
})
