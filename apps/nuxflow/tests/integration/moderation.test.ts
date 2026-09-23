/**
 * Tests for server/utils/moderation.ts — the background AI spam/abuse check layered on
 * top of Turnstile for comments/form submissions/contact. Previously untested.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { H3Event } from 'h3'

const mockGetAiSdkModel = vi.fn()
vi.mock('../../server/utils/ai-sdk', () => ({
  getAiSdkModel: (...args: unknown[]) => mockGetAiSdkModel(...args),
  callAiOrThrow: async <T>(fn: () => Promise<T>): Promise<T> => fn(),
}))

const mockGenerateObject = vi.fn()
vi.mock('ai', () => ({
  generateObject: (...args: unknown[]) => mockGenerateObject(...args),
}))

const { moderateText } = await import('../../server/utils/moderation')

function fakeEvent(): H3Event {
  return { context: { siteId: 'site-01' } } as unknown as H3Event
}

beforeEach(() => {
  mockGetAiSdkModel.mockReset()
  mockGenerateObject.mockReset()
})

describe('moderateText', () => {
  it('returns null for empty or whitespace-only text without calling the model', async () => {
    expect(await moderateText(fakeEvent(), '')).toBeNull()
    expect(await moderateText(fakeEvent(), '   ')).toBeNull()
    expect(mockGetAiSdkModel).not.toHaveBeenCalled()
  })

  it('returns null when no AI provider is configured — never blocks the submission path', async () => {
    mockGetAiSdkModel.mockResolvedValue(null)
    const result = await moderateText(fakeEvent(), 'Buy cheap watches now!!!')
    expect(result).toBeNull()
    expect(mockGenerateObject).not.toHaveBeenCalled()
  })

  it('returns the model\'s flagged/reason verdict on success', async () => {
    mockGetAiSdkModel.mockResolvedValue(Symbol('fake-model'))
    mockGenerateObject.mockResolvedValue({ object: { flagged: true, reason: 'Unsolicited link spam' } })

    const result = await moderateText(fakeEvent(), 'Click here for free crypto: bit.ly/xyz')

    expect(result).toEqual({ flagged: true, reason: 'Unsolicited link spam' })
  })

  it('returns null (not flagged) for genuine content, never throwing on a benign verdict', async () => {
    mockGetAiSdkModel.mockResolvedValue(Symbol('fake-model'))
    mockGenerateObject.mockResolvedValue({ object: { flagged: false, reason: '' } })

    const result = await moderateText(fakeEvent(), 'Great article, thanks for sharing!')

    expect(result).toEqual({ flagged: false, reason: '' })
  })

  it('swallows an AI SDK failure and returns null rather than throwing — must never block a legitimate submission', async () => {
    mockGetAiSdkModel.mockResolvedValue(Symbol('fake-model'))
    mockGenerateObject.mockRejectedValue(new Error('Provider timeout'))
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await moderateText(fakeEvent(), 'Some comment text')

    expect(result).toBeNull()
    expect(consoleErrorSpy).toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })

  it('truncates very long text before sending it to the model', async () => {
    mockGetAiSdkModel.mockResolvedValue(Symbol('fake-model'))
    mockGenerateObject.mockResolvedValue({ object: { flagged: false, reason: '' } })

    await moderateText(fakeEvent(), 'x'.repeat(10_000))

    const [callArgs] = mockGenerateObject.mock.calls.at(-1) as [{ prompt: string }]
    expect(callArgs.prompt.length).toBeLessThanOrEqual(4000)
  })
})
