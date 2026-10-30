import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { sites, siteSettings } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { SENSITIVE_SETTING_KEYS, SECRET_MASK, isEnvFallbackWithheld, isOllamaAvailable } from '../../../utils/settings'
import { planIncludes } from '../../../utils/hosting-plans'
import { requireSiteId } from '../../../utils/site-context'
import { defaultFromAddresses, loadEmailConfig } from '../../../utils/email'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = requireSiteId(event)

  const site = await db.query.sites.findFirst({
    where: eq(sites.id, siteId),
    columns: { id: true, name: true, domain: true, locale: true, timezone: true, status: true, isPrimary: true },
  })

  if (!site) throw notFound('Site not found')

  const settingRows = await db.query.siteSettings.findMany({
    where: and(eq(siteSettings.siteId, siteId)),
  })

  const settings: Record<string, unknown> = {}
  for (const row of settingRows) {
    if (SENSITIVE_SETTING_KEYS.has(row.key)) {
      settings[row.key] = row.value ? SECRET_MASK : ''
    } else {
      settings[row.key] = row.value
    }
  }

  // Fallback environment variable masking
  const envMap: Record<string, string> = {
    'email.resend_api_key': 'resendApiKey',
    'email.brevo_api_key': 'brevoApiKey',
    'email.zepto_api_key': 'zeptoApiKey',
    'payments.stripe_secret_key': 'stripeSecretKey',
    'payments.stripe_webhook_secret': 'stripeWebhookSecret',
    'payments.ls_api_key': 'lsApiKey',
    'payments.ls_webhook_secret': 'lsWebhookSecret',
    'payments.paddle_api_key': 'paddleApiKey',
    'payments.paddle_webhook_secret': 'paddleWebhookSecret',
    'ai.openai_api_key': 'openaiApiKey',
    'ai.anthropic_api_key': 'anthropicApiKey',
    'ai.gemini_api_key': 'geminiApiKey',
    'ai.deepseek_api_key': 'deepseekApiKey',
    'cloudflare.stream_token': 'cloudflareStreamToken',
    'cloudflare.images_token': 'cloudflareImagesToken',
    'auth.google_client_secret': 'googleClientSecret',
    'auth.github_client_secret': 'githubClientSecret',
  }

  const rc = useRuntimeConfig()
  for (const [key, rcKey] of Object.entries(envMap)) {
    // Only shown as configured where the site really inherits it (resolveSetting()
    // withholds PLATFORM_ONLY_ENV_KEYS from every site but the primary one, and
    // HOSTING_PLATFORM_ONLY_ENV_KEYS too while the hosting platform is on).
    if (await isEnvFallbackWithheld(db, key, site.isPrimary)) continue
    if (!settings[key] && rc[rcKey]) {
      settings[key] = SECRET_MASK
    }
  }

  // Expose non-sensitive cloudflare env vars so the UI can show them as placeholders
  // (withheld from customer sites on a hosting platform, like the tokens above).
  const cfAccountId = rc.cloudflareAccountId as string | undefined
  if (!settings['cloudflare.account_id'] && cfAccountId && !(await isEnvFallbackWithheld(db, 'cloudflare.account_id', site.isPrimary))) settings['cloudflare.account_id'] = cfAccountId
  const cfDeliveryUrl = rc.cloudflareImagesDeliveryUrl as string | undefined
  if (!settings['cloudflare.images_delivery_url'] && cfDeliveryUrl && !(await isEnvFallbackWithheld(db, 'cloudflare.images_delivery_url', site.isPrimary))) settings['cloudflare.images_delivery_url'] = cfDeliveryUrl

  // Same for the R2 public URL env var.
  const nonSensitiveMediaEnv: Record<string, string> = {
    'media.r2_public_url': 'r2PublicUrl',
  }
  for (const [key, rcKey] of Object.entries(nonSensitiveMediaEnv)) {
    const envVal = rc[rcKey] as string | undefined
    if (!settings[key] && envVal) settings[key] = envVal
  }

  // Same for the non-sensitive Google/GitHub OAuth client IDs — on the primary site only.
  // Social login is one OAuth app for the whole deployment, configured on the primary
  // site; showing the env value on a tenant's Settings page meant its next save copied
  // the platform's client ID into that tenant's own settings (and its backups).
  if (site.isPrimary) {
    const googleClientId = rc.googleClientId as string | undefined
    if (!settings['auth.google_client_id'] && googleClientId) settings['auth.google_client_id'] = googleClientId
    const githubClientId = rc.githubClientId as string | undefined
    if (!settings['auth.github_client_id'] && githubClientId) settings['auth.github_client_id'] = githubClientId
  }

  return {
    site,
    settings,
    ollamaAvailable: await isOllamaAvailable(event),
    imageTransformationsAvailable: await planIncludes(db, siteId, 'imageTransformations'),
    // What the Email tab shows while nothing is saved: the provider actually used (a
    // customer site falls back to Cloudflare, not the server log) and the From addresses.
    emailDefaults: {
      provider: (await loadEmailConfig(event)).emailProvider,
      fromAddress: await defaultFromAddresses(event, siteId, site.domain),
    },
  }
})
