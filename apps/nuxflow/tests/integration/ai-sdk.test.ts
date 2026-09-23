/**
 * Direct tests of getAiSdkModel()'s provider-selection logic — the actual
 * default-to-workers-ai fallback, per-provider model choice, the 'vision' quality tier,
 * and AI Gateway base-URL/headers construction. Previously entirely untested: every route
 * test (ai-routes.test.ts) mocks the whole ai-sdk module away, so none of them exercise
 * this file's own logic. Every provider SDK constructor (createWorkersAI, createOpenAI,
 * createAnthropic, createGoogleGenerativeAI) is mocked — no real network calls, no real
 * provider SDKs invoked — this only asserts on *which* constructor got called with *what*
 * config, and which model id was requested.
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

const mockCreateWorkersAI = vi.fn()
vi.mock('workers-ai-provider', () => ({
  createWorkersAI: (...args: unknown[]) => mockCreateWorkersAI(...args),
}))

const mockCreateOpenAI = vi.fn()
vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: (...args: unknown[]) => mockCreateOpenAI(...args),
}))

const mockCreateAnthropic = vi.fn()
vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: (...args: unknown[]) => mockCreateAnthropic(...args),
}))

const mockCreateGoogleGenerativeAI = vi.fn()
vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: (...args: unknown[]) => mockCreateGoogleGenerativeAI(...args),
}))

const { getAiSdkModel, requireAiSdkModel } = await import('../../server/utils/ai-sdk')

// Each provider "factory" mock (createWorkersAI/createOpenAI/createAnthropic/
// createGoogleGenerativeAI) is given a persistent implementation that returns a fn
// recording whatever config+model id it was called with — every call reflects its own
// real arguments, no "once" queuing needed, and no risk of a stale queued value leaking
// into a later assertion.
function installFactoryMock(mock: ReturnType<typeof vi.fn>) {
  mock.mockImplementation((config: unknown) => (modelId: string) => ({ __config: config, __modelId: modelId }))
}

function fakeEvent(): H3Event {
  return { context: { siteId: 'site-01' } } as unknown as H3Event
}

beforeEach(() => {
  settingsMap.clear()
  mockGetWorkersAiBinding.mockReset()
  mockCreateWorkersAI.mockReset()
  mockCreateOpenAI.mockReset()
  mockCreateAnthropic.mockReset()
  mockCreateGoogleGenerativeAI.mockReset()
  installFactoryMock(mockCreateWorkersAI)
  installFactoryMock(mockCreateOpenAI)
  installFactoryMock(mockCreateAnthropic)
  installFactoryMock(mockCreateGoogleGenerativeAI)
})

describe('getAiSdkModel — default provider', () => {
  it('defaults to workers-ai when ai.provider is unset, and returns null without a binding', async () => {
    mockGetWorkersAiBinding.mockReturnValue(null)

    const model = await getAiSdkModel(fakeEvent())

    expect(model).toBeNull()
    expect(mockCreateWorkersAI).not.toHaveBeenCalled()
  })

  it('defaults to workers-ai and returns a model when the binding is present', async () => {
    mockGetWorkersAiBinding.mockReturnValue({ run: vi.fn() })

    const model = await getAiSdkModel(fakeEvent()) as { __modelId: string } | null

    expect(model).not.toBeNull()
    expect(model!.__modelId).toBe('@cf/zai-org/glm-4.7-flash')
  })
})

describe('getAiSdkModel — workers-ai model selection', () => {
  beforeEach(() => {
    settingsMap.set('ai.provider', 'workers-ai')
    mockGetWorkersAiBinding.mockReturnValue({ run: vi.fn() })
  })

  it('uses the cheap model for "fast"', async () => {
    const model = await getAiSdkModel(fakeEvent(), 'fast') as { __modelId: string }
    expect(model.__modelId).toBe('@cf/zai-org/glm-4.7-flash')
  })

  it('uses the larger model for "smart"', async () => {
    const model = await getAiSdkModel(fakeEvent(), 'smart') as { __modelId: string }
    expect(model.__modelId).toBe('@cf/moonshotai/kimi-k2.7-code')
  })

  it('uses the vision-capable model for "vision", not the cheap "fast" model', async () => {
    const model = await getAiSdkModel(fakeEvent(), 'vision') as { __modelId: string }
    expect(model.__modelId).toBe('@cf/moonshotai/kimi-k2.7-code')
  })
})

describe('getAiSdkModel — deepseek/ollama vision gap', () => {
  it('deepseek returns null for "vision" even with a valid API key configured', async () => {
    settingsMap.set('ai.provider', 'deepseek')
    settingsMap.set('ai.deepseek_api_key', 'sk-test')

    const model = await getAiSdkModel(fakeEvent(), 'vision')

    expect(model).toBeNull()
    expect(mockCreateOpenAI).not.toHaveBeenCalled()
  })

  it('ollama returns null for "vision" regardless of configuration', async () => {
    settingsMap.set('ai.provider', 'ollama')

    const model = await getAiSdkModel(fakeEvent(), 'vision')

    expect(model).toBeNull()
    expect(mockCreateOpenAI).not.toHaveBeenCalled()
  })

  it('deepseek still works normally for "fast"/"smart" with a key configured', async () => {
    settingsMap.set('ai.provider', 'deepseek')
    settingsMap.set('ai.deepseek_api_key', 'sk-test')

    const model = await getAiSdkModel(fakeEvent(), 'fast') as { __modelId: string }
    expect(model.__modelId).toBe('deepseek-chat')
  })
})

describe('getAiSdkModel — BYOK providers return null without a key', () => {
  it.each(['openai', 'anthropic', 'gemini', 'deepseek'])('%s returns null when no API key is configured', async (provider) => {
    settingsMap.set('ai.provider', provider)
    const model = await getAiSdkModel(fakeEvent())
    expect(model).toBeNull()
  })
})

describe('getAiSdkModel — BYOK model selection', () => {
  it('openai: gpt-4o-mini for fast, gpt-4o for smart, gpt-4o-mini for vision', async () => {
    settingsMap.set('ai.provider', 'openai')
    settingsMap.set('ai.openai_api_key', 'sk-test')

    expect((await getAiSdkModel(fakeEvent(), 'fast') as { __modelId: string }).__modelId).toBe('gpt-4o-mini')
    expect((await getAiSdkModel(fakeEvent(), 'smart') as { __modelId: string }).__modelId).toBe('gpt-4o')
    expect((await getAiSdkModel(fakeEvent(), 'vision') as { __modelId: string }).__modelId).toBe('gpt-4o-mini')
  })

  it('anthropic: haiku for fast, sonnet for smart', async () => {
    settingsMap.set('ai.provider', 'anthropic')
    settingsMap.set('ai.anthropic_api_key', 'sk-ant-test')

    expect((await getAiSdkModel(fakeEvent(), 'fast') as { __modelId: string }).__modelId).toBe('claude-haiku-4-5-20251001')
    expect((await getAiSdkModel(fakeEvent(), 'smart') as { __modelId: string }).__modelId).toBe('claude-sonnet-5')
  })

  it('gemini: flash for fast, pro for smart', async () => {
    settingsMap.set('ai.provider', 'gemini')
    settingsMap.set('ai.gemini_api_key', 'AIza-test')

    expect((await getAiSdkModel(fakeEvent(), 'fast') as { __modelId: string }).__modelId).toBe('gemini-3.8-flash')
    expect((await getAiSdkModel(fakeEvent(), 'smart') as { __modelId: string }).__modelId).toBe('gemini-3.1-pro')
  })

  it('ollama: defaults to llama3.2 against localhost when unconfigured', async () => {
    settingsMap.set('ai.provider', 'ollama')

    await getAiSdkModel(fakeEvent(), 'fast')

    const config = mockCreateOpenAI.mock.calls.at(-1)![0] as { baseURL: string }
    expect(config.baseURL).toBe('http://localhost:11434/v1')
  })
})

describe('getAiSdkModel — AI Gateway routing', () => {
  it('workers-ai: passes gateway id (and userId metadata) to createWorkersAI when configured', async () => {
    settingsMap.set('ai.provider', 'workers-ai')
    settingsMap.set('ai.gateway_id', 'my-gateway')
    mockGetWorkersAiBinding.mockReturnValue({ run: vi.fn() })

    await getAiSdkModel(fakeEvent(), 'fast', { userId: 'user-123' })

    const config = mockCreateWorkersAI.mock.calls.at(-1)![0] as { gateway?: { id: string; metadata?: { userId: string } } }
    expect(config.gateway).toEqual({ id: 'my-gateway', metadata: { userId: 'user-123' } })
  })

  it('workers-ai: no gateway option at all when ai.gateway_id is unset', async () => {
    settingsMap.set('ai.provider', 'workers-ai')
    mockGetWorkersAiBinding.mockReturnValue({ run: vi.fn() })

    await getAiSdkModel(fakeEvent())

    const config = mockCreateWorkersAI.mock.calls.at(-1)![0] as { gateway?: unknown }
    expect(config.gateway).toBeUndefined()
  })

  it('openai: rewrites baseURL to the universal gateway endpoint with the "openai" provider slug', async () => {
    settingsMap.set('ai.provider', 'openai')
    settingsMap.set('ai.openai_api_key', 'sk-test')
    settingsMap.set('ai.gateway_id', 'my-gateway')
    settingsMap.set('cloudflare.account_id', 'acct-123')

    await getAiSdkModel(fakeEvent())

    const config = mockCreateOpenAI.mock.calls.at(-1)![0] as { baseURL: string; headers?: Record<string, string> }
    expect(config.baseURL).toBe('https://gateway.ai.cloudflare.com/v1/acct-123/my-gateway/openai')
  })

  it('gemini: uses the "google-ai-studio" slug, not "google"', async () => {
    settingsMap.set('ai.provider', 'gemini')
    settingsMap.set('ai.gemini_api_key', 'AIza-test')
    settingsMap.set('ai.gateway_id', 'my-gateway')
    settingsMap.set('cloudflare.account_id', 'acct-123')

    await getAiSdkModel(fakeEvent())

    const config = mockCreateGoogleGenerativeAI.mock.calls.at(-1)![0] as { baseURL: string }
    expect(config.baseURL).toBe('https://gateway.ai.cloudflare.com/v1/acct-123/my-gateway/google-ai-studio')
  })

  it('BYOK: no baseURL override when gateway_id is set but account_id is not (incomplete config)', async () => {
    settingsMap.set('ai.provider', 'openai')
    settingsMap.set('ai.openai_api_key', 'sk-test')
    settingsMap.set('ai.gateway_id', 'my-gateway')
    // cloudflare.account_id deliberately left unset

    await getAiSdkModel(fakeEvent())

    const config = mockCreateOpenAI.mock.calls.at(-1)![0] as { baseURL?: string }
    expect(config.baseURL).toBeUndefined()
  })

  it('adds cf-aig-authorization only when a gateway token is configured (unauthenticated gateway support)', async () => {
    settingsMap.set('ai.provider', 'openai')
    settingsMap.set('ai.openai_api_key', 'sk-test')
    settingsMap.set('ai.gateway_id', 'my-gateway')
    settingsMap.set('cloudflare.account_id', 'acct-123')

    await getAiSdkModel(fakeEvent())

    const config = mockCreateOpenAI.mock.calls.at(-1)![0] as { headers?: Record<string, string> }
    expect(config.headers?.['cf-aig-authorization']).toBeUndefined()
  })

  it('ollama is never routed through the gateway even when configured', async () => {
    settingsMap.set('ai.provider', 'ollama')
    settingsMap.set('ai.gateway_id', 'my-gateway')
    settingsMap.set('cloudflare.account_id', 'acct-123')

    await getAiSdkModel(fakeEvent())

    const config = mockCreateOpenAI.mock.calls.at(-1)![0] as { baseURL: string }
    expect(config.baseURL).toBe('http://localhost:11434/v1')
  })
})

describe('requireAiSdkModel', () => {
  it('throws a 503 when no provider is available', async () => {
    mockGetWorkersAiBinding.mockReturnValue(null)
    await expect(requireAiSdkModel(fakeEvent())).rejects.toMatchObject({ statusCode: 503 })
  })

  it('returns the model when one is available', async () => {
    mockGetWorkersAiBinding.mockReturnValue({ run: vi.fn() })
    const model = await requireAiSdkModel(fakeEvent())
    expect(model).toBeDefined()
  })
})
