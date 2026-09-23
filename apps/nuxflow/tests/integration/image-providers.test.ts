/**
 * Tests for server/utils/image-providers/index.ts's getImageProvider() priority chain
 * (OpenAI DALL-E > Google Imagen > Workers AI Flux > null) and the new
 * WorkersAiImageProvider. Previously entirely untested — this is the first coverage for
 * the priority chain itself, not just the Workers AI addition.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { H3Event } from 'h3'

const settingsMap = new Map<string, string>()
vi.mock('../../server/utils/settings', () => ({
  resolveSetting: async (_event: unknown, key: string) => settingsMap.get(key) ?? '',
}))

const mockGetWorkersAiBinding = vi.fn()
vi.mock('../../server/utils/cf-env', () => ({
  getWorkersAiBinding: (...args: unknown[]) => mockGetWorkersAiBinding(...args),
}))

const mockGenerateImage = vi.fn()
vi.mock('ai', () => ({
  generateImage: (...args: unknown[]) => mockGenerateImage(...args),
}))

vi.mock('workers-ai-provider', () => ({
  createWorkersAI: () => ({ image: (modelId: string) => ({ modelId }) }),
}))

const { getImageProvider } = await import('../../server/utils/image-providers/index')

function fakeEvent(): H3Event {
  return { context: { siteId: 'site-01' } } as unknown as H3Event
}

beforeEach(() => {
  settingsMap.clear()
  mockGetWorkersAiBinding.mockReset()
  mockGenerateImage.mockReset()
})

describe('getImageProvider — priority chain', () => {
  it('returns null when nothing is configured', async () => {
    mockGetWorkersAiBinding.mockReturnValue(null)
    const provider = await getImageProvider(fakeEvent())
    expect(provider).toBeNull()
  })

  it('falls back to Workers AI (zero-config) when no BYOK key is set but the binding is present', async () => {
    mockGetWorkersAiBinding.mockReturnValue({ run: vi.fn() })
    const provider = await getImageProvider(fakeEvent())
    expect(provider?.name).toBe('workers-ai')
  })

  it('prefers OpenAI (DALL-E) over Workers AI when both are available', async () => {
    settingsMap.set('ai.openai_api_key', 'sk-test')
    mockGetWorkersAiBinding.mockReturnValue({ run: vi.fn() })
    const provider = await getImageProvider(fakeEvent())
    expect(provider?.name).toBe('openai')
  })

  it('prefers Google Imagen over Workers AI when no OpenAI key is set', async () => {
    settingsMap.set('ai.gemini_api_key', 'AIza-test')
    mockGetWorkersAiBinding.mockReturnValue({ run: vi.fn() })
    const provider = await getImageProvider(fakeEvent())
    expect(provider?.name).toBe('google')
  })

  it('prefers OpenAI over Google Imagen when both BYOK keys are set', async () => {
    settingsMap.set('ai.openai_api_key', 'sk-test')
    settingsMap.set('ai.gemini_api_key', 'AIza-test')
    const provider = await getImageProvider(fakeEvent())
    expect(provider?.name).toBe('openai')
  })
})

describe('WorkersAiImageProvider', () => {
  it('returns a base64 data URL built from the generated image bytes', async () => {
    mockGetWorkersAiBinding.mockReturnValue({ run: vi.fn() })
    const bytes = new Uint8Array([137, 80, 78, 71]) // PNG magic bytes
    mockGenerateImage.mockResolvedValueOnce({ images: [{ uint8Array: bytes }] })

    const provider = await getImageProvider(fakeEvent())
    const url = await provider!.generate('A mountain landscape at sunset')

    expect(url).toMatch(/^data:image\/png;base64,/)
    const base64Part = url.split(',')[1]!
    expect(Buffer.from(base64Part, 'base64')).toEqual(Buffer.from(bytes))
  })

  it('throws a clear error when Workers AI returns no image data', async () => {
    mockGetWorkersAiBinding.mockReturnValue({ run: vi.fn() })
    mockGenerateImage.mockResolvedValueOnce({ images: [] })

    const provider = await getImageProvider(fakeEvent())
    await expect(provider!.generate('A prompt')).rejects.toThrow(/no image data/i)
  })

  it('isConfigured() is always true — it needs only the binding, already checked before construction', () => {
    // Constructed indirectly via getImageProvider above in every other test; this just
    // pins the (trivial but part of the ImageProvider contract) isConfigured() behavior.
    mockGetWorkersAiBinding.mockReturnValue({ run: vi.fn() })
    return getImageProvider(fakeEvent()).then((provider) => {
      expect(provider!.isConfigured()).toBe(true)
    })
  })
})
