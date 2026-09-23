/**
 * Integration tests for POST /api/v1/ai/transcribe (Whisper voice-to-text via Workers AI).
 * Deliberately Workers-AI-only — see the route's own doc comment. Workers AI is mocked;
 * no real network calls.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole } from '../helpers/seed'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

vi.mock('../../server/utils/rate-limit', () => ({
  rateLimit: vi.fn().mockResolvedValue(undefined),
}))

const mockGetWorkersAiBinding = vi.fn()
vi.mock('../../server/utils/cf-env', () => ({
  getWorkersAiBinding: (...args: unknown[]) => mockGetWorkersAiBinding(...args),
}))

const mockTranscribe = vi.fn()
vi.mock('ai', () => ({
  transcribe: (...args: unknown[]) => mockTranscribe(...args),
}))

vi.mock('workers-ai-provider', () => ({
  createWorkersAI: () => ({ transcription: (modelId: string) => ({ modelId }) }),
}))

const { default: transcribeHandler } = await import('../../server/api/v1/ai/transcribe.post')

const SITE = 'site-transcribe-01'
let editorId: string

type HandlerFn = (e: H3Event) => Promise<unknown>

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: 'transcribe.localhost' })
  editorId = await seedUser(db, { email: 'editor@transcribe.test' })
  await seedRole(db, editorId, SITE, 'editor')
})

afterAll(teardownTestDb)

function mkEvent(formData: FormData) {
  return createMockEvent({
    siteId: SITE,
    session: { user: { id: editorId, name: 'Editor', email: 'editor@transcribe.test' } },
    formData,
  }) as unknown as H3Event
}

describe('POST /api/v1/ai/transcribe', () => {
  it('returns 503 when the Workers AI binding is unavailable', async () => {
    mockGetWorkersAiBinding.mockReturnValue(null)
    const fd = new FormData()
    fd.set('file', new File([new Uint8Array([1, 2, 3])], 'clip.webm', { type: 'audio/webm' }))
    await expect((transcribeHandler as HandlerFn)(mkEvent(fd))).rejects.toMatchObject({ statusCode: 503 })
  })

  it('returns 400 when no file is provided', async () => {
    mockGetWorkersAiBinding.mockReturnValue({ run: vi.fn() })
    await expect((transcribeHandler as HandlerFn)(mkEvent(new FormData()))).rejects.toMatchObject({ statusCode: 400 })
  })

  it('returns 415 for a non-audio file type', async () => {
    mockGetWorkersAiBinding.mockReturnValue({ run: vi.fn() })
    const fd = new FormData()
    fd.set('file', new File([new Uint8Array([1, 2, 3])], 'notes.txt', { type: 'text/plain' }))
    await expect((transcribeHandler as HandlerFn)(mkEvent(fd))).rejects.toMatchObject({ statusCode: 415 })
  })

  it('returns the transcribed text for a valid audio file', async () => {
    mockGetWorkersAiBinding.mockReturnValue({ run: vi.fn() })
    mockTranscribe.mockResolvedValueOnce({ text: 'This is my draft post idea.' })
    const fd = new FormData()
    fd.set('file', new File([new Uint8Array([1, 2, 3])], 'clip.webm', { type: 'audio/webm' }))

    const result = await (transcribeHandler as HandlerFn)(mkEvent(fd)) as { text: string }

    expect(result.text).toBe('This is my draft post idea.')
  })

  it('returns 502 when the transcription call fails', async () => {
    mockGetWorkersAiBinding.mockReturnValue({ run: vi.fn() })
    mockTranscribe.mockRejectedValueOnce(new Error('Model unavailable'))
    const fd = new FormData()
    fd.set('file', new File([new Uint8Array([1, 2, 3])], 'clip.webm', { type: 'audio/webm' }))

    await expect((transcribeHandler as HandlerFn)(mkEvent(fd))).rejects.toMatchObject({ statusCode: 502 })
  })
})
