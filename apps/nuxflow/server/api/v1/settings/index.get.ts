import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { sites, siteSettings } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { SENSITIVE_SETTING_KEYS, SECRET_MASK } from '../../../utils/settings'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string

  const site = await db.query.sites.findFirst({
    where: eq(sites.id, siteId),
    columns: { id: true, name: true, domain: true, locale: true, timezone: true, status: true },
  })

  if (!site) throw createError({ statusCode: 404, message: 'Site not found' })

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
    'email.smtp_pass': 'smtpPass',
    'payments.stripe_secret_key': 'stripeSecretKey',
    'payments.stripe_webhook_secret': 'stripeWebhookSecret',
    'payments.ls_api_key': 'lsApiKey',
    'payments.ls_webhook_secret': 'lsWebhookSecret',
    'payments.paddle_api_key': 'paddleApiKey',
    'payments.paddle_webhook_public_key': 'paddleWebhookPublicKey',
    'ai.openai_api_key': 'openaiApiKey',
    'ai.anthropic_api_key': 'anthropicApiKey',
    'ai.gemini_api_key': 'geminiApiKey',
    'ai.deepseek_api_key': 'deepseekApiKey',
    'cloudflare.stream_token': 'cloudflareStreamToken',
    'cloudflare.images_token': 'cloudflareImagesToken',
  }

  const rc = useRuntimeConfig()
  for (const [key, rcKey] of Object.entries(envMap)) {
    if (!settings[key] && rc[rcKey]) {
      settings[key] = SECRET_MASK
    }
  }

  // Expose non-sensitive cloudflare env vars so the UI can show them as placeholders
  const cfAccountId = rc.cloudflareAccountId as string | undefined
  if (!settings['cloudflare.account_id'] && cfAccountId) settings['cloudflare.account_id'] = cfAccountId
  const cfDeliveryUrl = rc.cloudflareImagesDeliveryUrl as string | undefined
  if (!settings['cloudflare.images_delivery_url'] && cfDeliveryUrl) settings['cloudflare.images_delivery_url'] = cfDeliveryUrl

  return { site, settings }
})
