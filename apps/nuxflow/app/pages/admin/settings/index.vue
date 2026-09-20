<script setup lang="ts">
import type {
  GeneralState,
  AppearanceState,
  EmailState,
  IntegrationsState,
  SocialState,
  PaymentsState,
  AiState,
  CloudflareMediaState,
  R2State,
  S3State,
  BunnyState,
  PushState,
  SecurityState,
} from '~/types/admin-settings'

definePageMeta({ layout: 'admin', middleware: ['auth'] })

interface SiteData {
  site: { id: string; name: string; domain: string; locale: string; timezone: string; status: string }
  settings: Record<string, unknown>
}

const { data, refresh } = await useFetch<SiteData>('/api/v1/settings')

const tabs = [
  { label: 'General', icon: 'i-lucide-settings' },
  { label: 'Appearance', icon: 'i-lucide-palette' },
  { label: 'Email', icon: 'i-lucide-mail' },
  { label: 'Payments', icon: 'i-lucide-credit-card' },
  { label: 'Media', icon: 'i-lucide-hard-drive' },
  { label: 'Integrations', icon: 'i-lucide-plug' },
  { label: 'AI Settings', icon: 'i-lucide-bot' },
  { label: 'Push', icon: 'i-lucide-bell' },
  { label: 'Security', icon: 'i-lucide-shield-check' },
  { label: 'Danger zone', icon: 'i-lucide-triangle-alert' },
]
const route = useRoute()
const active = ref(
  tabs.some(t => t.label === route.query.tab)
    ? (route.query.tab as string)
    : 'General',
)

const { loading: saving, run: runSave } = useAdminAction()

// Each reactive object below is owned by this page and passed down to the
// corresponding tab component by reference — a child mutating e.g. `general.name`
// mutates this same object, so switching tabs (which unmounts the previously active
// tab component) never loses an edit: the data lives here, not in the child.
const general = reactive<GeneralState>({
  name: '',
  domain: '',
  locale: 'en',
  timezone: 'UTC',
  status: 'active',
  notificationEmail: '',
  allowPublicRegistration: false,
})

const appearance = reactive<AppearanceState>({
  showHeader: true,
  showSearch: true,
  showStickyHeader: true,
  logoSize: 'md',
  faviconUrl: '',
  logoUrl: '',
  customHeadHtml: '',
  customBodyHtml: '',
})

const email = reactive<EmailState>({
  provider: 'console',
  fromAddress: '',
  resendApiKey: '',
  brevoApiKey: '',
  zeptoApiKey: '',
})

const integrations = reactive<IntegrationsState>({ turnstileSiteKey: '' })

// Per-site Google/GitHub OAuth app credentials — falls back to the
// NUXT_GOOGLE_CLIENT_ID etc. env vars when no per-site override is saved.
const social = reactive<SocialState>({
  googleClientId: '',
  googleClientSecret: '',
  githubClientId: '',
  githubClientSecret: '',
})

const payments = reactive<PaymentsState>({
  signupsDisabled: false,
  signupsDisabledMessage: '',
  stripeSecretKey: '',
  stripeWebhookSecret: '',
  lsApiKey: '',
  lsStoreId: '',
  lsWebhookSecret: '',
  paddleApiKey: '',
  paddleVendorId: '',
  paddleWebhookSecret: '',
  paddleSandbox: false,
})

const ai = reactive<AiState>({
  provider: 'openai',
  openaiApiKey: '',
  anthropicApiKey: '',
  geminiApiKey: '',
  deepseekApiKey: '',
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaModel: 'llama3',
})

const cloudflare = reactive<CloudflareMediaState>({
  accountId: '',
  streamToken: '',
  imagesToken: '',
  imagesDeliveryUrl: '',
})

const r2 = reactive<R2State>({
  publicUrl: '',
})

const s3 = reactive<S3State>({
  bucket: '',
  accessKey: '',
  secretKey: '',
  region: 'us-east-1',
  endpoint: '',
  publicUrl: '',
})

const bunny = reactive<BunnyState>({
  apiKey: '',
  storageZone: '',
  pullZone: '',
})

const push = reactive<PushState>({
  vapidPublicKey: null,
  eventsContentPublished: false,
  eventsPaymentConfirmation: true,
  eventsFormSubmission: true,
})

const security = reactive<SecurityState>({
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
})

// ── Populate from API ─────────────────────────────────────────────────────────
watch(data, (d) => {
  if (!d) return
  Object.assign(general, {
    name: d.site.name,
    domain: d.site.domain,
    locale: d.site.locale,
    timezone: d.site.timezone,
    status: d.site.status,
  })
  const s = d.settings
  general.notificationEmail = (s['notificationEmail'] as string) ?? ''
  general.allowPublicRegistration = s['auth.allow_public_registration'] === 'true'
  email.provider = (s['email.provider'] as string) ?? 'console'
  email.fromAddress = (s['email.from_address'] as string) ?? ''
  email.resendApiKey = (s['email.resend_api_key'] as string) ?? ''
  email.brevoApiKey = (s['email.brevo_api_key'] as string) ?? ''
  email.zeptoApiKey = (s['email.zepto_api_key'] as string) ?? ''
  integrations.turnstileSiteKey = (s['integrations.turnstile_site_key'] as string) ?? ''
  social.googleClientId = (s['auth.google_client_id'] as string) ?? ''
  social.googleClientSecret = (s['auth.google_client_secret'] as string) ?? ''
  social.githubClientId = (s['auth.github_client_id'] as string) ?? ''
  social.githubClientSecret = (s['auth.github_client_secret'] as string) ?? ''
  appearance.showHeader = (s['frontend.show_header'] as boolean | undefined) !== false
  appearance.showSearch = (s['frontend.show_search'] as boolean | undefined) !== false
  appearance.showStickyHeader = (s['frontend.show_sticky_header'] as boolean | undefined) !== false
  appearance.logoSize = ((s['frontend.logo_size'] as string | undefined) ?? 'md') as 'sm' | 'md' | 'lg'
  appearance.faviconUrl = (s['appearance.favicon_url'] as string) ?? ''
  appearance.logoUrl = (s['appearance.logo_url'] as string) ?? ''
  appearance.customHeadHtml = (s['appearance.custom_head_html'] as string) ?? ''
  appearance.customBodyHtml = (s['appearance.custom_body_html'] as string) ?? ''

  payments.signupsDisabled = s['payments.signups_disabled'] === 'true'
  payments.signupsDisabledMessage = (s['payments.signups_disabled_message'] as string) ?? ''
  payments.stripeSecretKey = (s['payments.stripe_secret_key'] as string) ?? ''
  payments.stripeWebhookSecret = (s['payments.stripe_webhook_secret'] as string) ?? ''
  payments.lsApiKey = (s['payments.ls_api_key'] as string) ?? ''
  payments.lsStoreId = (s['payments.ls_store_id'] as string) ?? ''
  payments.lsWebhookSecret = (s['payments.ls_webhook_secret'] as string) ?? ''
  payments.paddleApiKey = (s['payments.paddle_api_key'] as string) ?? ''
  payments.paddleVendorId = (s['payments.paddle_vendor_id'] as string) ?? ''
  payments.paddleWebhookSecret = (s['payments.paddle_webhook_secret'] as string) ?? ''
  payments.paddleSandbox = s['payments.paddle_sandbox'] === 'true'

  ai.provider = (s['ai.provider'] as string) ?? 'openai'
  ai.openaiApiKey = (s['ai.openai_api_key'] as string) ?? ''
  ai.anthropicApiKey = (s['ai.anthropic_api_key'] as string) ?? ''
  ai.geminiApiKey = (s['ai.gemini_api_key'] as string) ?? ''
  ai.deepseekApiKey = (s['ai.deepseek_api_key'] as string) ?? ''
  ai.ollamaBaseUrl = (s['ai.ollama_base_url'] as string) ?? 'http://localhost:11434'
  ai.ollamaModel = (s['ai.ollama_model'] as string) ?? 'llama3'

  push.vapidPublicKey = (s['push.vapid_public_key'] as string) || null
  push.eventsContentPublished = s['push.events.content_published'] === 'true'
  push.eventsPaymentConfirmation = s['push.events.payment_confirmation'] !== 'false'
  push.eventsFormSubmission = s['push.events.form_submission'] !== 'false'

  cloudflare.accountId = (s['cloudflare.account_id'] as string) ?? ''
  cloudflare.streamToken = (s['cloudflare.stream_token'] as string) ?? ''
  cloudflare.imagesToken = (s['cloudflare.images_token'] as string) ?? ''
  cloudflare.imagesDeliveryUrl = (s['cloudflare.images_delivery_url'] as string) ?? ''

  r2.publicUrl = (s['media.r2_public_url'] as string) ?? ''

  s3.bucket = (s['media.s3_bucket'] as string) ?? ''
  s3.accessKey = (s['media.s3_access_key'] as string) ?? ''
  s3.secretKey = (s['media.s3_secret_key'] as string) ?? ''
  s3.region = (s['media.s3_region'] as string) || 'us-east-1'
  s3.endpoint = (s['media.s3_endpoint'] as string) ?? ''
  s3.publicUrl = (s['media.s3_public_url'] as string) ?? ''

  bunny.apiKey = (s['media.bunny_api_key'] as string) ?? ''
  bunny.storageZone = (s['media.bunny_storage_zone'] as string) ?? ''
  bunny.pullZone = (s['media.bunny_pull_zone'] as string) ?? ''
}, { immediate: true })

// The single shared save button, used by every tab except Push's event toggles (which
// also uses it), Security (its own password-change action), and Danger zone (its own
// delete action) — mirrors the single PATCH /api/v1/settings request the server always
// expects: whatever's currently in these reactive objects, regardless of which tab is
// visible, saves together in one call.
async function save() {
  await runSave(async () => {
    const settingsMap: Record<string, unknown> = {
      'email.provider': email.provider,
      'email.from_address': email.fromAddress,
      'email.resend_api_key': email.resendApiKey,
      'email.brevo_api_key': email.brevoApiKey,
      'email.zepto_api_key': email.zeptoApiKey,
      'integrations.turnstile_site_key': integrations.turnstileSiteKey,
      'frontend.show_header': appearance.showHeader,
      'frontend.show_search': appearance.showSearch,
      'frontend.show_sticky_header': appearance.showStickyHeader,
      'frontend.logo_size': appearance.logoSize,
      'appearance.favicon_url': appearance.faviconUrl || null,
      'appearance.logo_url': appearance.logoUrl || null,
      'appearance.custom_head_html': appearance.customHeadHtml || null,
      'appearance.custom_body_html': appearance.customBodyHtml || null,
      'notificationEmail': general.notificationEmail || null,
      'auth.allow_public_registration': general.allowPublicRegistration ? 'true' : 'false',
      'push.events.content_published': push.eventsContentPublished ? 'true' : 'false',
      'push.events.payment_confirmation': push.eventsPaymentConfirmation ? 'true' : 'false',
      'push.events.form_submission': push.eventsFormSubmission ? 'true' : 'false',
      'payments.signups_disabled': payments.signupsDisabled ? 'true' : 'false',
      'payments.signups_disabled_message': payments.signupsDisabledMessage || null,
      'payments.stripe_secret_key': payments.stripeSecretKey,
      'payments.stripe_webhook_secret': payments.stripeWebhookSecret,
      'payments.ls_api_key': payments.lsApiKey,
      'payments.ls_store_id': payments.lsStoreId,
      'payments.ls_webhook_secret': payments.lsWebhookSecret,
      'payments.paddle_api_key': payments.paddleApiKey,
      'payments.paddle_vendor_id': payments.paddleVendorId,
      'payments.paddle_webhook_secret': payments.paddleWebhookSecret,
      'payments.paddle_sandbox': payments.paddleSandbox ? 'true' : 'false',
    }
    await $fetch<unknown>('/api/v1/settings', {
      method: 'PATCH',
      body: {
        name: general.name,
        domain: general.domain,
        locale: general.locale,
        timezone: general.timezone,
        status: general.status,
        settings: settingsMap,
        ai: {
          provider: ai.provider,
          openaiApiKey: ai.openaiApiKey,
          anthropicApiKey: ai.anthropicApiKey,
          geminiApiKey: ai.geminiApiKey,
          deepseekApiKey: ai.deepseekApiKey,
          ollamaBaseUrl: ai.ollamaBaseUrl,
          ollamaModel: ai.ollamaModel,
        },
        cloudflare: {
          accountId: cloudflare.accountId,
          streamToken: cloudflare.streamToken,
          imagesToken: cloudflare.imagesToken,
          imagesDeliveryUrl: cloudflare.imagesDeliveryUrl,
        },
        media: {
          r2PublicUrl: r2.publicUrl,
          s3Bucket: s3.bucket,
          s3AccessKey: s3.accessKey,
          s3SecretKey: s3.secretKey,
          s3Region: s3.region,
          s3Endpoint: s3.endpoint,
          s3PublicUrl: s3.publicUrl,
          bunnyApiKey: bunny.apiKey,
          bunnyStorageZone: bunny.storageZone,
          bunnyPullZone: bunny.pullZone,
        },
        auth: {
          googleClientId: social.googleClientId,
          googleClientSecret: social.googleClientSecret,
          githubClientId: social.githubClientId,
          githubClientSecret: social.githubClientSecret,
        },
      },
    })
    await refresh()
  }, { successTitle: 'Settings saved', errorTitle: 'Failed to save settings' })
}
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-xl font-bold text-gray-900 dark:text-white">Settings</h1>

    <div class="flex gap-6">
      <!-- Sidebar nav -->
      <nav class="w-48 shrink-0 space-y-0.5">
        <button
          v-for="tab in tabs"
          :key="tab.label"
          class="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left"
          :class="active === tab.label
            ? 'bg-primary-50 text-primary-700 dark:bg-primary-950 dark:text-primary-400'
            : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'"
          @click="active = tab.label"
        >
          <UIcon :name="tab.icon" class="w-4 h-4" />
          {{ tab.label }}
        </button>
      </nav>

      <!-- Tab content -->
      <div class="flex-1 space-y-4">
        <AdminSettingsGeneralTab v-if="active === 'General'" v-model:general="general" :saving="saving" :on-save="save" />
        <AdminSettingsAppearanceTab v-if="active === 'Appearance'" v-model:appearance="appearance" :saving="saving" :on-save="save" />
        <AdminSettingsEmailTab v-if="active === 'Email'" v-model:email="email" :domain="general.domain" :saving="saving" :on-save="save" />
        <AdminSettingsPaymentsTab v-if="active === 'Payments'" v-model:payments="payments" :domain="general.domain" :saving="saving" :on-save="save" />
        <AdminSettingsMediaTab v-if="active === 'Media'" v-model:cloudflare="cloudflare" v-model:r2="r2" v-model:s3="s3" v-model:bunny="bunny" :saving="saving" :on-save="save" />
        <AdminSettingsIntegrationsTab v-if="active === 'Integrations'" v-model:integrations="integrations" v-model:social="social" :domain="general.domain" :saving="saving" :on-save="save" />
        <AdminSettingsAiTab v-if="active === 'AI Settings'" v-model:ai="ai" :saving="saving" :on-save="save" />
        <AdminSettingsPushTab v-if="active === 'Push'" v-model:push="push" :saving="saving" :on-save="save" />
        <AdminSettingsSecurityTab v-if="active === 'Security'" v-model:security="security" />
        <AdminSettingsDangerZoneTab
          v-if="active === 'Danger zone' && data"
          :site-id="data.site.id"
          :site-name="data.site.name"
        />
      </div>
    </div>
  </div>
</template>
