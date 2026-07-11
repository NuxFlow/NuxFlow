import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { sites } from '@nuxflow/db/schema'
import { eq, sql } from 'drizzle-orm'
import { saveSetting } from '../../../utils/settings'
import { clearAppearanceCache } from '../../../plugins/site-settings-resolver'

const bodySchema = z.object({
  // Site columns
  name: z.string().min(1).max(100).optional(),
  domain: z.string().min(1).max(100).optional(),
  locale: z.string().optional(),
  timezone: z.string().optional(),
  status: z.enum(['active', 'maintenance']).optional(),
  // Site settings (key-value store)
  settings: z.record(z.string(), z.unknown()).optional(),
  // AI settings compatibility
  ai: z.object({
    provider: z.string().optional(),
    openaiApiKey: z.string().optional(),
    anthropicApiKey: z.string().optional(),
    geminiApiKey: z.string().optional(),
    deepseekApiKey: z.string().optional(),
    ollamaBaseUrl: z.string().optional(),
    ollamaModel: z.string().optional(),
  }).optional(),
  // Cloudflare media settings
  cloudflare: z.object({
    accountId: z.string().optional(),
    streamToken: z.string().optional(),
    imagesToken: z.string().optional(),
    imagesDeliveryUrl: z.string().optional(),
  }).optional(),
  // S3-compatible and Bunny.net media storage — per-site overrides of the env-var
  // fallbacks in nuxt.config.ts, resolved the same way as the Cloudflare settings above.
  media: z.object({
    s3Bucket: z.string().optional(),
    s3AccessKey: z.string().optional(),
    s3SecretKey: z.string().optional(),
    s3Region: z.string().optional(),
    s3Endpoint: z.string().optional(),
    s3PublicUrl: z.string().optional(),
    bunnyApiKey: z.string().optional(),
    bunnyStorageZone: z.string().optional(),
    bunnyPullZone: z.string().optional(),
  }).optional(),
  // Per-site Google/GitHub OAuth app credentials — per-site overrides of the
  // NUXT_GOOGLE_CLIENT_ID etc. env-var fallbacks, same resolveSetting() pattern
  // as everything else on this page.
  auth: z.object({
    googleClientId: z.string().optional(),
    googleClientSecret: z.string().optional(),
    githubClientId: z.string().optional(),
    githubClientSecret: z.string().optional(),
  }).optional(),
})

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const body = await readValidatedBody(event, bodySchema.parse)

  const siteUpdate = {
    ...(body.name !== undefined && { name: body.name }),
    ...(body.domain !== undefined && { domain: body.domain }),
    ...(body.locale !== undefined && { locale: body.locale }),
    ...(body.timezone !== undefined && { timezone: body.timezone }),
    ...(body.status !== undefined && { status: body.status }),
  }

  if (Object.keys(siteUpdate).length > 0) {
    await db.update(sites)
      .set({ ...siteUpdate, updatedAt: sql`(datetime('now'))` })
      .where(eq(sites.id, siteId))
  }

  if (body.settings) {
    for (const [key, value] of Object.entries(body.settings)) {
      await saveSetting(event, key, value)
    }
  }

  if (body.ai) {
    const ai = body.ai
    if (ai.provider !== undefined) await saveSetting(event, 'ai.provider', ai.provider)
    if (ai.openaiApiKey !== undefined) await saveSetting(event, 'ai.openai_api_key', ai.openaiApiKey)
    if (ai.anthropicApiKey !== undefined) await saveSetting(event, 'ai.anthropic_api_key', ai.anthropicApiKey)
    if (ai.geminiApiKey !== undefined) await saveSetting(event, 'ai.gemini_api_key', ai.geminiApiKey)
    if (ai.deepseekApiKey !== undefined) await saveSetting(event, 'ai.deepseek_api_key', ai.deepseekApiKey)
    if (ai.ollamaBaseUrl !== undefined) await saveSetting(event, 'ai.ollama_base_url', ai.ollamaBaseUrl)
    if (ai.ollamaModel !== undefined) await saveSetting(event, 'ai.ollama_model', ai.ollamaModel)
  }

  if (body.cloudflare) {
    const cf = body.cloudflare
    if (cf.accountId !== undefined) await saveSetting(event, 'cloudflare.account_id', cf.accountId)
    if (cf.streamToken !== undefined) await saveSetting(event, 'cloudflare.stream_token', cf.streamToken)
    if (cf.imagesToken !== undefined) await saveSetting(event, 'cloudflare.images_token', cf.imagesToken)
    if (cf.imagesDeliveryUrl !== undefined) await saveSetting(event, 'cloudflare.images_delivery_url', cf.imagesDeliveryUrl)
  }

  if (body.media) {
    const m = body.media
    if (m.s3Bucket !== undefined) await saveSetting(event, 'media.s3_bucket', m.s3Bucket)
    if (m.s3AccessKey !== undefined) await saveSetting(event, 'media.s3_access_key', m.s3AccessKey)
    if (m.s3SecretKey !== undefined) await saveSetting(event, 'media.s3_secret_key', m.s3SecretKey)
    if (m.s3Region !== undefined) await saveSetting(event, 'media.s3_region', m.s3Region)
    if (m.s3Endpoint !== undefined) await saveSetting(event, 'media.s3_endpoint', m.s3Endpoint)
    if (m.s3PublicUrl !== undefined) await saveSetting(event, 'media.s3_public_url', m.s3PublicUrl)
    if (m.bunnyApiKey !== undefined) await saveSetting(event, 'media.bunny_api_key', m.bunnyApiKey)
    if (m.bunnyStorageZone !== undefined) await saveSetting(event, 'media.bunny_storage_zone', m.bunnyStorageZone)
    if (m.bunnyPullZone !== undefined) await saveSetting(event, 'media.bunny_pull_zone', m.bunnyPullZone)
  }

  if (body.auth) {
    const a = body.auth
    if (a.googleClientId !== undefined) await saveSetting(event, 'auth.google_client_id', a.googleClientId)
    if (a.googleClientSecret !== undefined) await saveSetting(event, 'auth.google_client_secret', a.googleClientSecret)
    if (a.githubClientId !== undefined) await saveSetting(event, 'auth.github_client_id', a.githubClientId)
    if (a.githubClientSecret !== undefined) await saveSetting(event, 'auth.github_client_secret', a.githubClientSecret)
    // The Better Auth instance caches socialProviders per host for 5 minutes —
    // bust it so a credential change is live immediately, not after a wait.
    clearBetterAuthCache()
  }

  // If any appearance settings changed, bust the per-isolate cache so the next
  // page render picks up the new values immediately.
  const appearanceKeys = new Set(['theme.dark_mode', 'theme.primary_color', 'theme.font_sans'])
  const touchedAppearance = body.settings && Object.keys(body.settings).some(k => appearanceKeys.has(k))
  if (touchedAppearance) clearAppearanceCache(siteId)

  return { success: true }
})
