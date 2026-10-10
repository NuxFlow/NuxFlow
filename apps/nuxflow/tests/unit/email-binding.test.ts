import { describe, it, expect, afterEach } from 'vitest'
import type { H3Event } from 'h3'
import { getEmailBinding } from '../../server/utils/cf-env'

const g = globalThis as { __env__?: Record<string, unknown> }
const original = g.__env__

afterEach(() => {
  g.__env__ = original
})

const eventWith = (env: Record<string, unknown> | undefined) =>
  ({ context: env ? { cloudflare: { env } } : {} }) as unknown as H3Event

describe('getEmailBinding()', () => {
  it('uses the binding on the request', () => {
    const fromRequest = { send: async () => ({}) }
    g.__env__ = { EMAIL: { send: async () => ({}) } }
    expect(getEmailBinding(eventWith({ EMAIL: fromRequest }))).toBe(fromRequest)
  })

  // A cached Better Auth instance can hand the email code an event that has outlived its
  // request; the Worker's own env still has the binding.
  it('falls back to the Worker env when the event carries no bindings', () => {
    const fromWorker = { send: async () => ({}) }
    g.__env__ = { EMAIL: fromWorker }
    expect(getEmailBinding(eventWith(undefined))).toBe(fromWorker)
  })

  it('returns null when neither has one', () => {
    g.__env__ = {}
    expect(getEmailBinding(eventWith({}))).toBeNull()
  })
})
