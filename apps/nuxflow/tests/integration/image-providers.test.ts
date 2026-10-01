/**
 * Tests for server/utils/image-providers/index.ts: the provider priority chain
 * (OpenAI > Google > Workers AI > null), the per-provider model/option mapping, and AI
 * Gateway routing. Every provider goes through the AI SDK's generateImage() — the old
 * DALL-E 3 and Imagen 3 integrations called models their vendors had already shut down.
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
  getCfBindings: () => ({ kv: null, loader: null, r2: null }),
}))

const mockGenerateImage = vi.fn()
vi.mock('ai', () => ({
  generateImage: (...args: unknown[]) => mockGenerateImage(...args),
}))

const mockCreateOpenAI = vi.fn()
vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: (config: unknown) => {
    mockCreateOpenAI(config)
    return { image: (modelId: string) => ({ provider: 'openai', modelId }) }
  },
}))

const mockCreateGoogle = vi.fn()
vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: (config: unknown) => {
    mockCreateGoogle(config)
    return { image: (modelId: string) => ({ provider: 'google', modelId }) }
  },
}))

const mockCreateWorkersAI = vi.fn()
vi.mock('workers-ai-provider', () => ({
  createWorkersAI: (config: unknown) => {
    mockCreateWorkersAI(config)
    return { image: (modelId: string) => ({ provider: 'workers-ai', modelId }) }
  },
}))

const { getImageProvider } = await import('../../server/utils/image-providers/index')

function fakeEvent(): H3Event {
  return { context: { siteId: 'site-01' } } as unknown as H3Event
}

const PNG = new Uint8Array([137, 80, 78, 71])

beforeEach(() => {
  settingsMap.clear()
  mockGetWorkersAiBinding.mockReset()
  mockGenerateImage.mockReset()
  mockCreateOpenAI.mockReset()
  mockCreateGoogle.mockReset()
  mockCreateWorkersAI.mockReset()
})

describe('getImageProvider — priority chain', () => {
  it('returns null when nothing is configured', async () => {
    mockGetWorkersAiBinding.mockReturnValue(null)
    expect(await getImageProvider(fakeEvent())).toBeNull()
  })

  it('falls back to Workers AI (zero-config) when no BYOK key is set but the binding is present', async () => {
    mockGetWorkersAiBinding.mockReturnValue({ run: vi.fn() })
    expect((await getImageProvider(fakeEvent()))?.name).toBe('workers-ai')
  })

  it('prefers OpenAI over Workers AI when both are available', async () => {
    settingsMap.set('ai.openai_api_key', 'sk-test')
    mockGetWorkersAiBinding.mockReturnValue({ run: vi.fn() })
    expect((await getImageProvider(fakeEvent()))?.name).toBe('openai')
  })

  it('prefers Google over Workers AI when no OpenAI key is set', async () => {
    settingsMap.set('ai.gemini_api_key', 'AIza-test')
    mockGetWorkersAiBinding.mockReturnValue({ run: vi.fn() })
    expect((await getImageProvider(fakeEvent()))?.name).toBe('google')
  })

  it('prefers OpenAI over Google when both BYOK keys are set', async () => {
    settingsMap.set('ai.openai_api_key', 'sk-test')
    settingsMap.set('ai.gemini_api_key', 'AIza-test')
    expect((await getImageProvider(fakeEvent()))?.name).toBe('openai')
  })
})

describe('generate()', () => {
  it('openai: current image model, shape → supported size, hd → high quality, data URL back', async () => {
    settingsMap.set('ai.openai_api_key', 'sk-test')
    mockGenerateImage.mockResolvedValueOnce({ images: [{ uint8Array: PNG, mediaType: 'image/png' }] })

    const provider = await getImageProvider(fakeEvent())
    const url = await provider!.generate('A lighthouse', { shape: 'landscape', quality: 'hd' })

    const [args] = mockGenerateImage.mock.calls[0] as [{ model: { modelId: string }; size: string; providerOptions: unknown }]
    expect(args.model.modelId).toBe('gpt-image-1')
    expect(args.size).toBe('1536x1024')
    expect(args.providerOptions).toEqual({ openai: { quality: 'high' } })
    expect(url).toMatch(/^data:image\/png;base64,/)
    expect(Buffer.from(url.split(',')[1]!, 'base64')).toEqual(Buffer.from(PNG))
  })

  it('google: Gemini image model with an aspect ratio (Imagen IDs are rejected by the SDK)', async () => {
    settingsMap.set('ai.gemini_api_key', 'AIza-test')
    mockGenerateImage.mockResolvedValueOnce({ images: [{ uint8Array: PNG, mediaType: 'image/jpeg' }] })

    const provider = await getImageProvider(fakeEvent())
    const url = await provider!.generate('A lighthouse', { shape: 'portrait' })

    const [args] = mockGenerateImage.mock.calls[0] as [{ model: { modelId: string }; aspectRatio: string }]
    expect(args.model.modelId).toMatch(/^gemini-/)
    expect(args.aspectRatio).toBe('9:16')
    expect(url).toMatch(/^data:image\/jpeg;base64,/)
  })

  it('throws a clear error when the provider returns no image data', async () => {
    mockGetWorkersAiBinding.mockReturnValue({ run: vi.fn() })
    mockGenerateImage.mockResolvedValueOnce({ images: [] })

    const provider = await getImageProvider(fakeEvent())
    await expect(provider!.generate('A prompt')).rejects.toThrow(/no image data/i)
  })
})

describe('AI Gateway routing', () => {
  beforeEach(() => {
    settingsMap.set('ai.gateway_id', 'my-gateway')
    settingsMap.set('cloudflare.account_id', 'acct-123')
  })

  it('openai: gateway base URL plus per-user metadata', async () => {
    settingsMap.set('ai.openai_api_key', 'sk-test')
    await getImageProvider(fakeEvent(), { userId: 'user-1' })

    const config = mockCreateOpenAI.mock.calls[0]![0] as { baseURL: string; headers: Record<string, string> }
    expect(config.baseURL).toBe('https://gateway.ai.cloudflare.com/v1/acct-123/my-gateway/openai')
    expect(JSON.parse(config.headers['cf-aig-metadata']!)).toEqual({ userId: 'user-1' })
  })

  it('google: gateway base URL keeps the /v1beta segment', async () => {
    settingsMap.set('ai.gemini_api_key', 'AIza-test')
    await getImageProvider(fakeEvent())

    const config = mockCreateGoogle.mock.calls[0]![0] as { baseURL: string }
    expect(config.baseURL).toBe('https://gateway.ai.cloudflare.com/v1/acct-123/my-gateway/google-ai-studio/v1beta')
  })

  it('workers-ai: the binding\'s native gateway option', async () => {
    mockGetWorkersAiBinding.mockReturnValue({ run: vi.fn() })
    await getImageProvider(fakeEvent(), { userId: 'user-1' })

    const config = mockCreateWorkersAI.mock.calls[0]![0] as { gateway: unknown }
    expect(config.gateway).toEqual({ id: 'my-gateway', metadata: { userId: 'user-1' } })
  })
})
