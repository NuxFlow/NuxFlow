import { wrapLanguageModel, type LanguageModel } from 'ai'
import { isError, type H3Event } from 'h3'
import { resolveStringSetting, isOllamaAvailable } from './settings'
import { getCfBindings, getWorkersAiBinding } from './cf-env'
import { WORKER_MEDIA_PREFIX, workerMediaKey } from './media-url'
import { safeFetch } from './ssrf'
import { AiAllowanceError, allowanceForbidden, assertAiAllowance, checkAiAllowance, recordAiCall, textCredits, type AiPayer, type AiTrigger } from './ai-allowance'
import { base64ToBytes } from '../../shared/lib/base64'

/**
 * 'vision' is for routes that send image bytes to the model (alt-text.post.ts,
 * bulk-alt-text.post.ts) — kept distinct from 'fast'/'smart' because not every provider's
 * cheap/fast model is multimodal (Workers AI's fast text model, `glm-4.7-flash`, isn't;
 * its vision-capable model is a different, heavier one — see the workers-ai case below).
 * For Anthropic and Gemini this collapses to the same model 'fast' already used, since
 * claude-haiku-5-5/gemini-3.8-flash are vision-capable; OpenAI's uses its larger model.
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
  /**
   * Who sets the calls off (ai-allowance.ts). 'visitor' for anything the public or incoming
   * mail triggers (spam checks, inbox sorting) — charged to the visitor AI allowance, so it
   * can never use up the team's. Defaults to 'team'.
   */
  trigger?: AiTrigger
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
    resolveStringSetting(event, 'ai.gateway_id', 'aiGatewayId'),
    resolveStringSetting(event, 'cloudflare.account_id', 'cloudflareAccountId'),
    resolveStringSetting(event, 'ai.gateway_token', 'aiGatewayToken'),
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
 * A model plus who pays for its calls: 'platform' for the Workers AI binding or an AI key
 * inherited from the deployment's env vars, 'site' for the site's own key (ai-allowance.ts).
 * `heavy` marks the larger, pricier model, whose tokens count for more credits.
 */
export interface ResolvedAiModel {
  model: LanguageModel
  payer: AiPayer
  heavy: boolean
  /** Who sets the calls off — 'team' when left out (ai-allowance.ts). */
  trigger?: AiTrigger
}

/**
 * An AI setting's value and who pays for using it: the site's own saved value → 'site', the
 * deployment's env-var fallback → 'platform'. (On a hosting platform a customer's site never
 * gets the env fallback at all — settings.ts, HOSTING_PLATFORM_ONLY_ENV_KEYS.)
 */
export async function resolveAiKey(event: H3Event, key: string, envKey: string): Promise<{ value: string, payer: AiPayer }> {
  const own = await resolveStringSetting(event, key)
  if (own) return { value: own, payer: 'site' }
  return { value: (await resolveStringSetting(event, key, envKey)) || '', payer: 'platform' }
}

/**
 * Returns an AI SDK LanguageModel for the configured provider.
 * Returns null when the provider key is missing — callers throw 503 on null.
 * Each provider SDK is imported dynamically so a site configured for one
 * provider doesn't bundle the other five into the Worker.
 *
 * Every call made with the returned model is counted (`ai_calls`, and `ai_credits` when the
 * platform pays — ai-allowance.ts) here, once, rather than at each of the ~20 call sites.
 */
export async function getAiSdkModel(event: H3Event, quality: AiQuality = 'fast', opts: GetAiSdkModelOptions = {}): Promise<LanguageModel | null> {
  const resolved = await resolveAiSdkModel(event, quality, opts)
  return resolved ? withUsageCounting(event, resolved) : null
}

/**
 * Counts each generate/stream call the model makes — retries included, since each is a
 * real call. For a platform-paid model it also refuses the call once the site's AI
 * allowance (hosting plan) or the platform's daily cap is used up, and charges credits from
 * the tokens the call actually used. This is the gate for background AI too (spam checks,
 * inbox triage), which uses getAiSdkModel() and treats a thrown error as "skip";
 * interactive routes are stopped earlier, with a clear 403, by requireAiSdkModel(). A
 * site-paid model (the site's own key) is counted in `ai_calls` only and never refused.
 */
export function withUsageCounting(event: H3Event, resolved: ResolvedAiModel): LanguageModel {
  const { model, payer, heavy, trigger = 'team' } = resolved
  // A gateway model id string, or anything that isn't a provider model object, can't be wrapped.
  if (typeof model !== 'object' || !('specificationVersion' in model)) return model
  const guard = async () => {
    if (payer !== 'platform') return
    const check = await checkAiAllowance(event, 1, trigger)
    if (!check.allowed) throw new AiAllowanceError(check)
  }
  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: 'v4',
      wrapGenerate: async ({ doGenerate }) => {
        await guard()
        let tokens: number | undefined
        try {
          const result = await doGenerate()
          tokens = totalTokens(result.usage)
          return result
        } finally {
          // A failed call still counts (at the 1-credit minimum), so retrying a failing
          // call can't be a way round the allowance.
          recordAiCall(event, payer, textCredits(tokens, heavy), trigger)
        }
      },
      wrapStream: async ({ doStream }) => {
        await guard()
        const result = await doStream()
        let tokens: number | undefined
        const stream = result.stream.pipeThrough(new TransformStream({
          transform(part, controller) {
            if (part.type === 'finish') tokens = totalTokens(part.usage)
            controller.enqueue(part)
          },
          flush() {
            recordAiCall(event, payer, textCredits(tokens, heavy), trigger)
          },
        }))
        return { ...result, stream }
      },
    },
  })
}

function totalTokens(usage: { inputTokens?: { total?: number }, outputTokens?: { total?: number } } | undefined): number | undefined {
  if (!usage) return undefined
  const total = (usage.inputTokens?.total ?? 0) + (usage.outputTokens?.total ?? 0)
  return total > 0 ? total : undefined
}

async function resolveAiSdkModel(event: H3Event, quality: AiQuality, opts: GetAiSdkModelOptions): Promise<ResolvedAiModel | null> {
  const resolved = await resolveProviderModel(event, quality, opts)
  if (!resolved) return null
  return { ...resolved, heavy: quality !== 'fast', trigger: opts.trigger ?? 'team' }
}

async function resolveProviderModel(event: H3Event, quality: AiQuality, opts: GetAiSdkModelOptions): Promise<{ model: LanguageModel, payer: AiPayer } | null> {
  // No `ai.provider` setting saved yet (fresh install, or an existing deployment that never
  // configured a BYOK key) falls back to Workers AI rather than a hard 503 — it needs zero
  // account setup beyond the `[ai]` wrangler.toml binding (commented out by default —
  // uncomment before deploying; see CLAUDE.md's "AI providers" section for why it can't
  // just be active-by-default the way every other binding in that file is), so a Workers
  // Paid plan deployer (already required — see CLAUDE.md) gets working AI features with no
  // admin action beyond that one uncomment. If the binding genuinely isn't present (not yet
  // uncommented, or a self-hoster on an older wrangler.toml), the workers-ai case below
  // returns null exactly as the old unconfigured-provider default did — no regression.
  const provider = (await resolveStringSetting(event, 'ai.provider', 'aiProvider')) || 'workers-ai'

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
      // Checked against https://developers.cloudflare.com/workers-ai/models/ (Oct 2026) —
      // Cloudflare's catalog churns at least as fast as Gemini's (see the gemini case below),
      // so re-check before assuming these stay valid. kimi-k2.6 is the general-purpose large
      // model (vision input and structured outputs, both needed here) for 'smart'/'vision';
      // it replaced kimi-k2.7-code, a coding-tuned model that was writing page copy.
      // glm-4.7-flash is the cheap default for everyday 'fast' calls (grammar, improve, SEO
      // suggestions) and is not known to be vision-capable, hence the separate 'vision' branch.
      if (quality === 'vision' || quality === 'smart') return { model: workersai('@cf/moonshotai/kimi-k2.6'), payer: 'platform' }
      return { model: workersai('@cf/zai-org/glm-4.7-flash'), payer: 'platform' }
    }
    case 'openai': {
      const { value: apiKey, payer } = await resolveAiKey(event, 'ai.openai_api_key', 'openaiApiKey')
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
      // GPT-6 family (Oct 2026, https://developers.openai.com/api/docs/guides/latest-model):
      // 6.1 Sol is the balanced model, Luna the cheapest. Image input isn't documented for
      // Luna, so 'vision' uses Sol. Both are reasoning models — the SDK drops `temperature`
      // for them itself (improve.post.ts sets one).
      return { model: openai(quality === 'fast' ? 'gpt-6-luna' : 'gpt-6.1-sol'), payer }
    }
    case 'anthropic': {
      const { value: apiKey, payer } = await resolveAiKey(event, 'ai.anthropic_api_key', 'anthropicApiKey')
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
      return { model: anthropic(quality === 'smart' ? 'claude-sonnet-5-5' : 'claude-haiku-5-5'), payer }
    }
    case 'gemini': {
      const { value: apiKey, payer } = await resolveAiKey(event, 'ai.gemini_api_key', 'geminiApiKey')
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
      return { model: google(quality === 'smart' ? 'gemini-3.1-pro-preview' : 'gemini-3.8-flash'), payer }
    }
    case 'deepseek': {
      // DeepSeek's chat API has no vision support — returning null here converts what
      // would otherwise be a confusing provider-side "invalid content" error (image content
      // parts silently rejected/ignored) into a clean 503 callers already know how to
      // surface, instead of a fabricated-looking response.
      if (quality === 'vision') return null
      const { value: apiKey, payer } = await resolveAiKey(event, 'ai.deepseek_api_key', 'deepseekApiKey')
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
      return { model: deepseek('deepseek-chat'), payer }
    }
    case 'ollama': {
      // Same reasoning as deepseek above — whether the configured local model is
      // multimodal is entirely up to what the operator pulled, which this code has no way
      // to know, so a vision call isn't safe to assume works. Ollama is also deliberately
      // never routed through AI Gateway — it's a local-network target the Cloudflare edge
      // can't reach, unlike every other case above.
      if (quality === 'vision') return null
      if (!(await isOllamaAvailable(event))) return null
      const [{ value: url, payer }, model] = await Promise.all([
        resolveAiKey(event, 'ai.ollama_base_url', 'ollamaUrl'),
        resolveStringSetting(event, 'ai.ollama_model', 'ollamaModel'),
      ])
      const { createOpenAI } = await import('@ai-sdk/openai')
      const ollama = createOpenAI({ apiKey: 'ollama', baseURL: `${url || 'http://localhost:11434'}/v1` })
      return { model: ollama(model || 'llama3.2'), payer }
    }
    default:
      return null
  }
}

/** Same as getAiSdkModel, but throws the standard 503 instead of returning null. */
export async function requireAiSdkModel(event: H3Event, quality: AiQuality = 'fast', opts: GetAiSdkModelOptions = {}): Promise<LanguageModel> {
  const resolved = await resolveAiSdkModel(event, quality, opts)
  if (!resolved) {
    throw createError({ statusCode: 503, message: 'No AI provider configured. Add an API key in Settings → AI.' })
  }
  // Only AI the platform pays for is limited; the site's own key is never refused.
  if (resolved.payer === 'platform') await assertAiAllowance(event, 1, resolved.trigger)
  return withUsageCounting(event, resolved)
}

/** Runs an AI SDK call, throwing the standard 502 with a provider-friendly message on failure. */
export async function callAiOrThrow<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    // The allowance ran out between requireAiSdkModel()'s check and this call (a multi-call
    // route like translate, or a whole-site job) — the same 403 the up-front check gives.
    const allowance = findAllowanceError(err)
    if (allowance) throw allowanceForbidden(allowance)
    if (isError(err)) throw err
    throw createError({ statusCode: 502, message: aiErrorMessage(err) })
  }
}

/** The AiAllowanceError behind `err`, also when the AI SDK wrapped it in a RetryError. */
export function findAllowanceError(err: unknown): AiAllowanceError | null {
  if (err instanceof AiAllowanceError) return err
  const last = (err as { lastError?: unknown } | null)?.lastError
  return last instanceof AiAllowanceError ? last : null
}

/**
 * True for failures that will hit every call the same way (bad key, allowance used up,
 * rate limit, unknown model) — a loop over many items should stop rather than try each one.
 */
export function isSystemicAiError(err: unknown): boolean {
  if (findAllowanceError(err)) return true
  const status = providerStatus(err)
  return status === 401 || status === 403 || status === 404 || status === 429
}

function providerStatus(err: unknown): unknown {
  if (!err || typeof err !== 'object') return undefined
  // The AI SDK retries failed calls and then throws a RetryError whose own message is
  // "Failed after 3 attempts…" — the provider's status is on the last attempt's error.
  const e = ((err as { name?: unknown }).name === 'AI_RetryError' && (err as { lastError?: unknown }).lastError) || err
  if (!e || typeof e !== 'object') return undefined
  const { status, statusCode } = e as { status?: unknown; statusCode?: unknown }
  return typeof statusCode === 'number' ? statusCode : status
}

/**
 * Image formats every vision provider here accepts. SVG (vector markup, not pixels), HEIC,
 * TIFF, BMP and AVIF are refused by at least one of them with an unhelpful error.
 */
export const VISION_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const

export function isVisionImageType(mimeType: string): boolean {
  const base = mimeType.split(';')[0]!.trim().toLowerCase()
  return (VISION_IMAGE_TYPES as readonly string[]).includes(base === 'image/jpg' ? 'image/jpeg' : base)
}

export const VISION_IMAGE_TYPE_MESSAGE = 'AI can only describe JPEG, PNG, WebP and GIF images'

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
    const data = isBase64 ? base64ToBytes(payload) : new TextEncoder().encode(decodeURIComponent(payload))
    return { data, mediaType }
  }

  if (url.startsWith(WORKER_MEDIA_PREFIX)) {
    const siteId = event.context.siteId
    const key = siteId ? workerMediaKey(url, siteId) : null
    if (!key) throw new Error('Image is not stored under this site')
    const { r2 } = getCfBindings(event)
    if (!r2) throw new Error('Media bucket binding (MEDIA_BUCKET) is not available')
    const object = await r2.get(key)
    if (!object) throw new Error('Image not found in the media bucket')
    return { data: new Uint8Array(await object.arrayBuffer()), mediaType: object.httpMetadata?.contentType || fallbackMediaType }
  }

  if (!/^https?:\/\//i.test(url)) throw new Error('Unsupported image URL')
  // safeFetch, not fetch: a media row's url can arrive from a restored backup, so it
  // isn't trusted to be a public address.
  const res = await safeFetch(url)
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
  const allowance = findAllowanceError(err)
  if (allowance) return allowance.message
  if (err && typeof err === 'object') {
    const status = providerStatus(err)
    if (status === 401 || status === 403) return 'AI provider authentication failed — check your API key in Settings → AI'
    if (status === 429) return 'AI provider rate limit exceeded — try again in a moment'
    if (status === 404) return 'AI model not found — check your provider settings'
    // generateObject()'s answer didn't fit the schema — the raw message ("No object
    // generated: response did not match schema") means nothing to an editor.
    if ((err as { name?: unknown }).name === 'AI_NoObjectGeneratedError') return 'The AI\'s answer wasn\'t in the expected format — try again'
    const { message } = err as { message?: unknown }
    if (typeof message === 'string' && message) return message
  }
  return 'AI provider request failed'
}
