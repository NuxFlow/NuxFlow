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
import type * as AiAllowance from '../../server/utils/ai-allowance'
import { createError, type H3Event } from 'h3'
import type * as CfEnv from '../../server/utils/cf-env'

const settingsMap = new Map<string, string>()

vi.mock('../../server/utils/settings', () => ({
  resolveSetting: async (_event: unknown, key: string) => settingsMap.get(key) ?? '',
  resolveStringSetting: async (_event: unknown, key: string) => settingsMap.get(key) ?? '',
  // Hosting-platform gating has its own tests (hosting-plans.test.ts).
  isOllamaAvailable: async () => true,
}))

const mockGetWorkersAiBinding = vi.fn()
const mockR2Get = vi.fn()
vi.mock('../../server/utils/cf-env', async importOriginal => ({
  ...(await importOriginal<typeof CfEnv>()),
  getWorkersAiBinding: (...args: unknown[]) => mockGetWorkersAiBinding(...args),
  getCfBindings: () => ({ kv: null, loader: null, r2: { get: mockR2Get } }),
}))

// Hosting-plan allowances have their own tests (hosting-plans.test.ts); this file is
// about provider selection, and has no database for the plan lookup.
vi.mock('../../server/utils/hosting-plans', () => ({
  assertWithinPlan: async () => {},
  checkPlanLimit: async () => ({ key: 'ai', allowed: true, used: 0, max: null }),
  PlanLimitError: class extends Error {},
}))
// Allowance checks need a database; ai-allowance has its own tests (hosting-plans.test.ts).
vi.mock('../../server/utils/ai-allowance', async importOriginal => ({
  ...await importOriginal<typeof AiAllowance>(),
  checkAiAllowance: async () => ({ allowed: true }),
  assertAiAllowance: async () => {},
  recordAiCall: () => {},
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

const { getAiSdkModel, requireAiSdkModel, loadImageBytesForAi, aiErrorMessage } = await import('../../server/utils/ai-sdk')

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

describe('getAiSdkModel — public demo', () => {
  it('returns null in demo mode even with a binding and a BYOK key', async () => {
    mockGetWorkersAiBinding.mockReturnValue({ run: vi.fn() })
    settingsMap.set('ai.provider', 'openai')
    settingsMap.set('ai.openai_api_key', 'sk-test')
    const event = { context: { siteId: 'site-01', cloudflare: { env: { NUXT_IS_DEMO: 'true' } } } } as unknown as H3Event

    expect(await getAiSdkModel(event)).toBeNull()
    expect(mockCreateOpenAI).not.toHaveBeenCalled()
    await expect(requireAiSdkModel(event)).rejects.toMatchObject({ statusCode: 503 })
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
    expect(model.__modelId).toBe('@cf/moonshotai/kimi-k2.6')
  })

  it('uses the vision-capable model for "vision", not the cheap "fast" model', async () => {
    const model = await getAiSdkModel(fakeEvent(), 'vision') as { __modelId: string }
    expect(model.__modelId).toBe('@cf/moonshotai/kimi-k2.6')
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
  it('openai: gpt-6-luna for fast, gpt-6.1-sol for smart and vision', async () => {
    settingsMap.set('ai.provider', 'openai')
    settingsMap.set('ai.openai_api_key', 'sk-test')

    expect((await getAiSdkModel(fakeEvent(), 'fast') as { __modelId: string }).__modelId).toBe('gpt-6-luna')
    expect((await getAiSdkModel(fakeEvent(), 'smart') as { __modelId: string }).__modelId).toBe('gpt-6.1-sol')
    expect((await getAiSdkModel(fakeEvent(), 'vision') as { __modelId: string }).__modelId).toBe('gpt-6.1-sol')
  })

  it('anthropic: haiku for fast, sonnet for smart', async () => {
    settingsMap.set('ai.provider', 'anthropic')
    settingsMap.set('ai.anthropic_api_key', 'sk-ant-test')

    expect((await getAiSdkModel(fakeEvent(), 'fast') as { __modelId: string }).__modelId).toBe('claude-haiku-5-5')
    expect((await getAiSdkModel(fakeEvent(), 'smart') as { __modelId: string }).__modelId).toBe('claude-sonnet-5-5')
  })

  it('gemini: flash for fast, pro for smart', async () => {
    settingsMap.set('ai.provider', 'gemini')
    settingsMap.set('ai.gemini_api_key', 'AIza-test')

    expect((await getAiSdkModel(fakeEvent(), 'fast') as { __modelId: string }).__modelId).toBe('gemini-3.8-flash')
    expect((await getAiSdkModel(fakeEvent(), 'smart') as { __modelId: string }).__modelId).toBe('gemini-3.1-pro-preview')
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

  it('gemini: uses the "google-ai-studio" slug (not "google") plus the /v1beta segment the SDK expects', async () => {
    settingsMap.set('ai.provider', 'gemini')
    settingsMap.set('ai.gemini_api_key', 'AIza-test')
    settingsMap.set('ai.gateway_id', 'my-gateway')
    settingsMap.set('cloudflare.account_id', 'acct-123')

    await getAiSdkModel(fakeEvent())

    const config = mockCreateGoogleGenerativeAI.mock.calls.at(-1)![0] as { baseURL: string }
    // The AI SDK only appends `/models/...` to a custom base URL — without /v1beta every
    // gateway-routed Gemini call 404'd.
    expect(config.baseURL).toBe('https://gateway.ai.cloudflare.com/v1/acct-123/my-gateway/google-ai-studio/v1beta')
  })

  it('anthropic: includes the /v1 segment the AI SDK expects (it only appends /messages)', async () => {
    settingsMap.set('ai.provider', 'anthropic')
    settingsMap.set('ai.anthropic_api_key', 'sk-ant-test')
    settingsMap.set('ai.gateway_id', 'my-gateway')
    settingsMap.set('cloudflare.account_id', 'acct-123')

    await getAiSdkModel(fakeEvent())

    const config = mockCreateAnthropic.mock.calls.at(-1)![0] as { baseURL: string }
    expect(config.baseURL).toBe('https://gateway.ai.cloudflare.com/v1/acct-123/my-gateway/anthropic/v1')
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

describe('loadImageBytesForAi', () => {
  // R2 without a public URL stores site-relative /_nuxflow/media/<key> URLs, which fetch()
  // can't take — these used to make every alt-text/focal-point call fail.
  it('reads a Worker-served media URL straight from the R2 binding', async () => {
    mockR2Get.mockResolvedValueOnce({
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      httpMetadata: { contentType: 'image/webp' },
    })

    const result = await loadImageBytesForAi(fakeEvent(), '/_nuxflow/media/site-01/photo%20one.webp', 'image/jpeg')

    expect(mockR2Get).toHaveBeenCalledWith('site-01/photo one.webp')
    expect(result).toEqual({ data: new Uint8Array([1, 2, 3]), mediaType: 'image/webp' })
  })

  it('refuses a key outside the current site, or a traversal-shaped one', async () => {
    mockR2Get.mockReset()
    await expect(loadImageBytesForAi(fakeEvent(), '/_nuxflow/media/other-site/x.jpg', 'image/jpeg')).rejects.toThrow(/not stored under this site/)
    await expect(loadImageBytesForAi(fakeEvent(), '/_nuxflow/media/site-01/../other-site/x.jpg', 'image/jpeg')).rejects.toThrow(/not stored under this site/)
    expect(mockR2Get).not.toHaveBeenCalled()
  })

  it('decodes a data: URL without fetching', async () => {
    const result = await loadImageBytesForAi(fakeEvent(), 'data:image/png;base64,AQID', 'image/jpeg')
    expect(result).toEqual({ data: new Uint8Array([1, 2, 3]), mediaType: 'image/png' })
  })

  it('rejects any other relative or non-http URL', async () => {
    await expect(loadImageBytesForAi(fakeEvent(), '/uploads/x.jpg', 'image/jpeg')).rejects.toThrow(/Unsupported image URL/)
    await expect(loadImageBytesForAi(fakeEvent(), 'file:///etc/passwd', 'image/jpeg')).rejects.toThrow(/Unsupported image URL/)
  })
})

describe('aiErrorMessage', () => {
  it('maps provider auth/rate-limit/not-found statuses to actionable copy, ahead of the raw message', () => {
    expect(aiErrorMessage(Object.assign(new Error('Incorrect API key provided: sk-…'), { statusCode: 401 }))).toMatch(/check your API key/)
    expect(aiErrorMessage(Object.assign(new Error('Too Many Requests'), { status: 429 }))).toMatch(/rate limit/)
  })

  it('passes our own H3 errors through unchanged — a 404 lookup isn\'t "model not found"', () => {
    expect(aiErrorMessage(createError({ statusCode: 404, message: 'Content type not found' }))).toBe('Content type not found')
  })

  it('reads the provider status through the AI SDK RetryError', () => {
    const retry = Object.assign(new Error('Failed after 3 attempts. Last error: Too Many Requests'), {
      name: 'AI_RetryError',
      lastError: Object.assign(new Error('Too Many Requests'), { statusCode: 429 }),
    })
    expect(aiErrorMessage(retry)).toMatch(/rate limit/)
  })

  it('explains a schema mismatch in plain words', () => {
    const err = Object.assign(new Error('No object generated: response did not match schema.'), { name: 'AI_NoObjectGeneratedError' })
    expect(aiErrorMessage(err)).toMatch(/wasn't in the expected format/)
  })

  it('falls back to the raw message, then to a generic one', () => {
    expect(aiErrorMessage(new Error('socket hang up'))).toBe('socket hang up')
    expect(aiErrorMessage(null)).toBe('AI provider request failed')
  })
})
