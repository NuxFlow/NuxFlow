import type { LanguageModel } from 'ai'
import { isError, type H3Event } from 'h3'
import { resolveSetting } from './settings'
import { getCfBindings, getWorkersAiBinding } from './cf-env'
import { WORKER_MEDIA_PREFIX } from './media-url'

/**
 * 'vision' is for routes that send image bytes to the model (alt-text.post.ts,
 * bulk-alt-text.post.ts) — kept distinct from 'fast'/'smart' because not every provider's
 * cheap/fast model is multimodal (Workers AI's fast text model, `glm-4.7-flash`, isn't;
 * its vision-capable model is a different, heavier one — see the workers-ai case below).
 * For the five BYOK providers this collapses to the same model 'fast' already used, since
 * gpt-4o-mini/claude-haiku-4-5/gemini-3.8-flash are all already vision-capable.
 */
export type AiQuality = 'fast' | 'smart' | 'vision'

export interface GetAiSdkModelOptions {
  /**
   * Authenticated caller's user id, forwarded to AI Gateway as request metadata (when a
   * gateway is configured — see resolveGatewaySettings below) so per-user spend is visible
   * in the Cloudflare dashboard without waiting on provider-side usage reports. Every AI
   * route already resolves this via requireAuth/requireRole before calling getAiSdkModel.
   */
  userId?: string
}

export interface GatewaySettings { gatewayId: string; accountId: string; token: string }

/**
 * Reads the optional AI Gateway settings (Settings → AI → AI Gateway). All three come back
 * as empty strings when unset — callers decide what they actually need: the workers-ai
 * binding path only needs `gatewayId` (Workers AI already knows its own account since it's
 * a binding, not an HTTP call), while the BYOK base-URL-rewrite path below needs `gatewayId`
 * + `accountId` to build the universal gateway URL, and `token` only for an authenticated
 * gateway (an unauthenticated one is a valid, simpler setup for a single-operator site).
 */
export async function resolveGatewaySettings(event: H3Event): Promise<GatewaySettings> {
  const [gatewayId, accountId, token] = await Promise.all([
    resolveSetting(event, 'ai.gateway_id', 'aiGatewayId') as Promise<string>,
    resolveSetting(event, 'cloudflare.account_id', 'cloudflareAccountId') as Promise<string>,
    resolveSetting(event, 'ai.gateway_token', 'aiGatewayToken') as Promise<string>,
  ])
  return { gatewayId, accountId, token }
}

/**
 * Extra headers for a BYOK provider request routed through AI Gateway's universal endpoint
 * (https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/{provider}) — cf-aig-authorization
 * only applies to an authenticated gateway (empty token = unauthenticated gateway, header
 * omitted), cf-aig-metadata is the documented mechanism for attaching arbitrary per-request
 * metadata (max 5 flat entries) that shows up in the Gateway dashboard's request log.
 */
export function gatewayRequestHeaders(token: string, userId?: string): Record<string, string> | undefined {
  const headers: Record<string, string> = {}
  if (token) headers['cf-aig-authorization'] = `Bearer ${token}`
  if (userId) headers['cf-aig-metadata'] = JSON.stringify({ userId })
  return Object.keys(headers).length ? headers : undefined
}

/**
 * AI Gateway's provider-native endpoint for `path` (provider slug plus whatever version
 * segment the AI SDK provider expects its base URL to end in — see each call site).
 */
export function gatewayBaseUrl(accountId: string, gatewayId: string, path: string): string {
  return `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/${path}`
}

/**
 * Returns an AI SDK LanguageModel for the configured provider.
 * Returns null when the provider key is missing — callers throw 503 on null.
 * Each provider SDK is imported dynamically so a site configured for one
 * provider doesn't bundle the other five into the Worker.
 */
export async function getAiSdkModel(event: H3Event, quality: AiQuality = 'fast', opts: GetAiSdkModelOptions = {}): Promise<LanguageModel | null> {
  // No `ai.provider` setting saved yet (fresh install, or an existing deployment that never
  // configured a BYOK key) falls back to Workers AI rather than a hard 503 — it needs zero
  // account setup beyond the `[ai]` wrangler.toml binding (commented out by default —
  // uncomment before deploying; see CLAUDE.md's "AI providers" section for why it can't
  // just be active-by-default the way every other binding in that file is), so a Workers
  // Paid plan deployer (already required — see CLAUDE.md) gets working AI features with no
  // admin action beyond that one uncomment. If the binding genuinely isn't present (not yet
  // uncommented, or a self-hoster on an older wrangler.toml), the workers-ai case below
  // returns null exactly as the old unconfigured-provider default did — no regression.
  const provider = (await resolveSetting(event, 'ai.provider', 'aiProvider') as string | undefined) || 'workers-ai'

  switch (provider) {
    case 'workers-ai': {
      const ai = getWorkersAiBinding(event)
      if (!ai) return null
      const { createWorkersAI } = await import('workers-ai-provider')
      const { gatewayId } = await resolveGatewaySettings(event)
      const workersai = createWorkersAI({
        binding: ai,
        // Native binding gateway routing — a documented, stable option on createWorkersAI
        // (unlike this same package's experimental third-party-catalog-routing surface,
        // deliberately not used here — see CLAUDE.md's AI providers section). Metadata is
        // set at model-instance level since a fresh instance is created per request anyway.
        ...(gatewayId && { gateway: { id: gatewayId, ...(opts.userId && { metadata: { userId: opts.userId } }) } }),
      })
      // Model IDs current as of the workers-ai-provider@4 README (Jul 2026) — Cloudflare's
      // catalog churns at least as fast as Gemini's does (see the gemini case below), so
      // re-check https://developers.cloudflare.com/workers-ai/models/ before assuming these
      // stay valid. kimi-k2.7-code is the vision-capable model (also handles 'smart' — it's
      // the larger, 256k-context, tool+reasoning-capable model); glm-4.7-flash is the cheap
      // default for everyday 'fast' calls (grammar, improve, SEO suggestions) and is not
      // known to be vision-capable, hence the separate 'vision' branch.
      if (quality === 'vision' || quality === 'smart') return workersai('@cf/moonshotai/kimi-k2.7-code')
      return workersai('@cf/zai-org/glm-4.7-flash')
    }
    case 'openai': {
      const apiKey = await resolveSetting(event, 'ai.openai_api_key', 'openaiApiKey') as string
      if (!apiKey) return null
      const { createOpenAI } = await import('@ai-sdk/openai')
      const { gatewayId, accountId, token } = await resolveGatewaySettings(event)
      const openai = createOpenAI({
        apiKey,
        ...(gatewayId && accountId && {
          baseURL: gatewayBaseUrl(accountId, gatewayId, 'openai'),
          headers: gatewayRequestHeaders(token, opts.userId),
        }),
      })
      return openai(quality === 'smart' ? 'gpt-4o' : 'gpt-4o-mini')
    }
    case 'anthropic': {
      const apiKey = await resolveSetting(event, 'ai.anthropic_api_key', 'anthropicApiKey') as string
      if (!apiKey) return null
      const { createAnthropic } = await import('@ai-sdk/anthropic')
      const { gatewayId, accountId, token } = await resolveGatewaySettings(event)
      const anthropic = createAnthropic({
        apiKey,
        ...(gatewayId && accountId && {
          // The AI SDK appends just `/messages` to a custom base URL (its default already
          // includes /v1), so the version segment must be part of the gateway URL — without
          // it every gateway-routed Anthropic call 404'd.
          baseURL: gatewayBaseUrl(accountId, gatewayId, 'anthropic/v1'),
          headers: gatewayRequestHeaders(token, opts.userId),
        }),
      })
      return anthropic(quality === 'smart' ? 'claude-sonnet-5' : 'claude-haiku-4-5-20251001')
    }
    case 'gemini': {
      const apiKey = await resolveSetting(event, 'ai.gemini_api_key', 'geminiApiKey') as string
      if (!apiKey) return null
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
      const { gatewayId, accountId, token } = await resolveGatewaySettings(event)
      const google = createGoogleGenerativeAI({
        apiKey,
        // Cloudflare's AI Gateway provider slug for the Gemini API is "google-ai-studio",
        // not "google" — see https://developers.cloudflare.com/ai-gateway/usage/providers/.
        ...(gatewayId && accountId && {
          // Same as Anthropic: the SDK's default base URL ends in /v1beta and only
          // `/models/...` is appended to it.
          baseURL: gatewayBaseUrl(accountId, gatewayId, 'google-ai-studio/v1beta'),
          headers: gatewayRequestHeaders(token, opts.userId),
        }),
      })
      // gemini-1.5-* was fully retired by Google — every request 404'd. gemini-2.5-* (the
      // direct replacement) is itself scheduled to shut down mid-October 2026, so this uses
      // the current generation instead. Given how fast Google is deprecating Gemini model
      // IDs (three generations retired inside a year), re-check
      // https://ai.google.dev/gemini-api/docs/models before assuming these stay valid.
      return google(quality === 'smart' ? 'gemini-3.1-pro-preview' : 'gemini-3.8-flash')
    }
    case 'deepseek': {
      // DeepSeek's chat API has no vision support — returning null here converts what
      // would otherwise be a confusing provider-side "invalid content" error (image content
      // parts silently rejected/ignored) into a clean 503 callers already know how to
      // surface, instead of a fabricated-looking response.
      if (quality === 'vision') return null
      const apiKey = await resolveSetting(event, 'ai.deepseek_api_key', 'deepseekApiKey') as string
      if (!apiKey) return null
      const { createOpenAI } = await import('@ai-sdk/openai')
      const { gatewayId, accountId, token } = await resolveGatewaySettings(event)
      const deepseek = createOpenAI(gatewayId && accountId
        ? {
            apiKey,
            baseURL: gatewayBaseUrl(accountId, gatewayId, 'deepseek'),
            headers: gatewayRequestHeaders(token, opts.userId),
          }
        : { apiKey, baseURL: 'https://api.deepseek.com/v1' })
      return deepseek('deepseek-chat')
    }
    case 'ollama': {
      // Same reasoning as deepseek above — whether the configured local model is
      // multimodal is entirely up to what the operator pulled, which this code has no way
      // to know, so a vision call isn't safe to assume works. Ollama is also deliberately
      // never routed through AI Gateway — it's a local-network target the Cloudflare edge
      // can't reach, unlike every other case above.
      if (quality === 'vision') return null
      const [url, model] = await Promise.all([
        resolveSetting(event, 'ai.ollama_base_url', 'ollamaUrl') as Promise<string>,
        resolveSetting(event, 'ai.ollama_model', 'ollamaModel') as Promise<string>,
      ])
      const { createOpenAI } = await import('@ai-sdk/openai')
      const ollama = createOpenAI({ apiKey: 'ollama', baseURL: `${url || 'http://localhost:11434'}/v1` })
      return ollama(model || 'llama3.2')
    }
    default:
      return null
  }
}

/** Same as getAiSdkModel, but throws the standard 503 instead of returning null. */
export async function requireAiSdkModel(event: H3Event, quality: AiQuality = 'fast', opts: GetAiSdkModelOptions = {}): Promise<LanguageModel> {
  const model = await getAiSdkModel(event, quality, opts)
  if (!model) {
    throw createError({ statusCode: 503, message: 'No AI provider configured. Add an API key in Settings → AI.' })
  }
  return model
}

/** Runs an AI SDK call, throwing the standard 502 with a provider-friendly message on failure. */
export async function callAiOrThrow<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    throw createError({ statusCode: 502, message: aiErrorMessage(err) })
  }
}

/**
 * Fetches an already-uploaded media item's bytes so they can be passed to a multimodal
 * `generateText`/`generateObject` call as an image content part. Three URL shapes exist:
 *  - `data:` — the local fallback stores the file inline; decoded directly (fetch() in a
 *    Worker only supports http(s)).
 *  - `/_nuxflow/media/<key>` — R2 without a public URL serves files through this Worker
 *    (see media-providers/r2.ts). fetch() can't take a relative URL, so the object is read
 *    straight from the bucket binding — scoped to this site's own key prefix, exactly like
 *    the serving route.
 *  - an absolute http(s) URL — every other provider; fetched.
 */
export async function loadImageBytesForAi(event: H3Event, url: string, fallbackMediaType: string): Promise<{ data: Uint8Array; mediaType: string }> {
  if (url.startsWith('data:')) {
    const commaIndex = url.indexOf(',')
    if (commaIndex === -1) throw new Error('Malformed data URL')
    const header = url.slice(5, commaIndex)
    const isBase64 = header.endsWith(';base64')
    const mediaType = header.replace(/;base64$/, '') || fallbackMediaType
    const payload = url.slice(commaIndex + 1)
    const binary = isBase64 ? atob(payload) : decodeURIComponent(payload)
    const data = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i)
    return { data, mediaType }
  }

  if (url.startsWith(WORKER_MEDIA_PREFIX)) {
    const siteId = event.context.siteId as string | undefined
    const key = url.slice(WORKER_MEDIA_PREFIX.length).split('/').map(decodeURIComponent).join('/')
    if (!siteId || !key.startsWith(`${siteId}/`) || key.split('/').some(seg => seg === '' || seg === '.' || seg === '..')) {
      throw new Error('Image is not stored under this site')
    }
    const { r2 } = getCfBindings(event)
    if (!r2) throw new Error('Media bucket binding (MEDIA_BUCKET) is not available')
    const object = await r2.get(key)
    if (!object) throw new Error('Image not found in the media bucket')
    return { data: new Uint8Array(await object.arrayBuffer()), mediaType: object.httpMetadata?.contentType || fallbackMediaType }
  }

  if (!/^https?:\/\//i.test(url)) throw new Error('Unsupported image URL')
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch image for AI processing (${res.status})`)
  const buf = await res.arrayBuffer()
  return { data: new Uint8Array(buf), mediaType: res.headers.get('content-type') || fallbackMediaType }
}

/**
 * Extracts a human-readable message from a provider SDK error. Known HTTP statuses map to
 * actionable copy first — provider SDK errors always carry a raw `message` too, so checking
 * that first (as this used to) meant the friendly versions never showed.
 */
export function aiErrorMessage(err: unknown): string {
  // Our own errors (createError — e.g. callAiOrThrow's 502, a 404 from a lookup) already
  // carry the right message; only provider errors need translating.
  if (isError(err)) return err.message
  if (err && typeof err === 'object') {
    const e = err as { status?: unknown; statusCode?: unknown; message?: unknown }
    const status = typeof e.statusCode === 'number' ? e.statusCode : e.status
    if (status === 401 || status === 403) return 'AI provider authentication failed — check your API key in Settings → AI'
    if (status === 429) return 'AI provider rate limit exceeded — try again in a moment'
    if (status === 404) return 'AI model not found — check your provider settings'
    if (typeof e.message === 'string' && e.message) return e.message
  }
  return 'AI provider request failed'
}
