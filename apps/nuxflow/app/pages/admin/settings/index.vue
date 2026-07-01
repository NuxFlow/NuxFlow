<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })

interface SiteData {
  site: { id: string; name: string; domain: string; locale: string; timezone: string; status: string }
  settings: Record<string, unknown>
}

const { data, refresh } = await useFetch<SiteData>('/api/v1/settings')
const { user: currentUser } = useUserSession()
const auth = useAuthStore()

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

const saving = ref(false)
const toast = useToast()

// ── General ───────────────────────────────────────────────────────────────────
const general = reactive({
  name: '',
  domain: '',
  locale: 'en',
  timezone: 'UTC',
  status: 'active' as 'active' | 'maintenance',
  notificationEmail: '',
  allowPublicRegistration: false,
})

const localeOptions = [
  { label: 'English', value: 'en' },
  { label: 'French', value: 'fr' },
  { label: 'German', value: 'de' },
  { label: 'Spanish', value: 'es' },
  { label: 'Portuguese', value: 'pt' },
  { label: 'Japanese', value: 'ja' },
]

const timezones = [
  'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Asia/Tokyo', 'Asia/Singapore',
  'Australia/Sydney',
].map(v => ({ label: v, value: v }))

// ── Appearance ────────────────────────────────────────────────────────────────
const appearance = reactive({
  showHeader: true,
  showSearch: true,
  showStickyHeader: true,
  logoSize: 'md' as 'sm' | 'md' | 'lg',
  faviconUrl: '',
  logoUrl: '',
  customHeadHtml: '',
  customBodyHtml: '',
})

const logoSizeOptions = [
  { label: 'Small (24 px)', value: 'sm' },
  { label: 'Medium (32 px)', value: 'md' },
  { label: 'Large (40 px)', value: 'lg' },
]

const uploadingLogo = ref(false)

async function uploadLogo(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  uploadingLogo.value = true
  try {
    const fd = new FormData()
    fd.append('file', file)
    const result = await $fetch<{ url: string }>('/api/v1/media/upload', { method: 'POST', body: fd })
    appearance.logoUrl = result.url
    await save()
  } finally {
    uploadingLogo.value = false
    ;(e.target as HTMLInputElement).value = ''
  }
}

async function removeLogo() {
  appearance.logoUrl = ''
  await save()
}

const uploadingFavicon = ref(false)

async function uploadFavicon(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  uploadingFavicon.value = true
  try {
    const fd = new FormData()
    fd.append('file', file)
    const result = await $fetch<{ url: string }>('/api/v1/media/upload', { method: 'POST', body: fd })
    appearance.faviconUrl = result.url
    await save()
  } finally {
    uploadingFavicon.value = false
    ;(e.target as HTMLInputElement).value = ''
  }
}

async function removeFavicon() {
  appearance.faviconUrl = ''
  await save()
}

// ── Email ─────────────────────────────────────────────────────────────────────
const email = reactive({
  provider: 'console',
  fromAddress: '',
  resendApiKey: '',
  brevoApiKey: '',
  zeptoApiKey: '',
  smtpHost: '',
  smtpPort: '587',
  smtpUser: '',
  smtpPass: '',
})

const emailProviderOptions = [
  { label: 'Console (dev)', value: 'console' },
  { label: 'Resend', value: 'resend' },
  { label: 'Brevo', value: 'brevo' },
  { label: 'ZeptoMail', value: 'zepto' },
  { label: 'SMTP / MailChannels', value: 'smtp' },
]

const emailTestAddress = ref('')
const testingEmail = ref(false)
const emailTestResult = ref<{ ok: boolean; message: string } | null>(null)

async function sendTestEmail() {
  emailTestResult.value = null
  testingEmail.value = true
  try {
    const res = await $fetch<{ message: string }>('/api/v1/settings/email-test', {
      method: 'POST',
      body: {
        sendTo: emailTestAddress.value || undefined,
        provider: email.provider,
        fromAddress: email.fromAddress || undefined,
        resendApiKey: email.resendApiKey || undefined,
        brevoApiKey: email.brevoApiKey || undefined,
        zeptoApiKey: email.zeptoApiKey || undefined,
        smtpHost: email.smtpHost || undefined,
        smtpPort: email.smtpPort || undefined,
        smtpUser: email.smtpUser || undefined,
        smtpPass: email.smtpPass || undefined,
      },
    })
    emailTestResult.value = { ok: true, message: res.message }
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message ?? 'Test failed'
    emailTestResult.value = { ok: false, message: msg }
  } finally {
    testingEmail.value = false
  }
}

// ── Integrations ─────────────────────────────────────────────────────────────
const integrations = reactive({ turnstileSiteKey: '' })

const payments = reactive({
  signupsDisabled: false,
  signupsDisabledMessage: '',
  stripeSecretKey: '',
  stripeWebhookSecret: '',
  lsApiKey: '',
  lsStoreId: '',
  lsWebhookSecret: '',
  paddleApiKey: '',
  paddleVendorId: '',
  paddleWebhookPublicKey: '',
})

const ai = reactive({
  provider: 'openai',
  openaiApiKey: '',
  anthropicApiKey: '',
  geminiApiKey: '',
  deepseekApiKey: '',
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaModel: 'llama3',
})

const cloudflare = reactive({
  accountId: '',
  streamToken: '',
  imagesToken: '',
  imagesDeliveryUrl: '',
})

const aiProviderOptions = [
  { label: 'OpenAI', value: 'openai' },
  { label: 'Anthropic', value: 'anthropic' },
  { label: 'Google Gemini', value: 'gemini' },
  { label: 'DeepSeek', value: 'deepseek' },
  { label: 'Local (Ollama)', value: 'ollama' },
]

// ── Push notifications ────────────────────────────────────────────────────────
const push = reactive({
  vapidPublicKey: '' as string | null,
  eventsContentPublished: false,
  eventsPaymentConfirmation: true,
  eventsFormSubmission: true,
})
const pushSubscriberCount = ref(0)
const generatingVapid = ref(false)
const sendingTestPush = ref(false)
const broadcasting = ref(false)
const broadcastTitle = ref('')
const broadcastBody = ref('')
const broadcastUrl = ref('')

async function generateVapidKeys() {
  generatingVapid.value = true
  try {
    const { publicKey } = await $fetch<{ publicKey: string }>('/api/v1/push/vapid-keys', { method: 'POST' })
    push.vapidPublicKey = publicKey
    toast.add({ title: 'VAPID keys generated', color: 'green' })
  } catch {
    toast.add({ title: 'Failed to generate VAPID keys', color: 'red' })
  } finally {
    generatingVapid.value = false
  }
}

async function sendTestPush() {
  sendingTestPush.value = true
  try {
    await $fetch('/api/v1/push/test', { method: 'POST' })
    toast.add({ title: 'Test notification sent', color: 'green' })
  } catch {
    toast.add({ title: 'Failed — make sure you have subscribed to push notifications', color: 'red' })
  } finally {
    sendingTestPush.value = false
  }
}

async function sendBroadcast() {
  if (!broadcastTitle.value || !broadcastBody.value) return
  broadcasting.value = true
  try {
    await $fetch('/api/v1/push/broadcast', {
      method: 'POST',
      body: {
        title: broadcastTitle.value,
        body: broadcastBody.value,
        url: broadcastUrl.value || undefined,
      },
    })
    broadcastTitle.value = ''
    broadcastBody.value = ''
    broadcastUrl.value = ''
    toast.add({ title: 'Notification broadcast sent', color: 'green' })
  } catch {
    toast.add({ title: 'Broadcast failed', color: 'red' })
  } finally {
    broadcasting.value = false
  }
}

async function fetchPushSubscriberCount() {
  try {
    const { count } = await $fetch<{ count: number }>('/api/v1/push/subscribers')
    pushSubscriberCount.value = count
  } catch { /* ignore */ }
}

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
  email.smtpHost = (s['email.smtp_host'] as string) ?? ''
  email.smtpPort = (s['email.smtp_port'] as string) ?? '587'
  email.smtpUser = (s['email.smtp_user'] as string) ?? ''
  email.smtpPass = (s['email.smtp_pass'] as string) ?? ''
  if (!emailTestAddress.value) emailTestAddress.value = (currentUser.value as { email?: string })?.email ?? ''
  integrations.turnstileSiteKey = (s['integrations.turnstile_site_key'] as string) ?? ''
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
  payments.paddleWebhookPublicKey = (s['payments.paddle_webhook_public_key'] as string) ?? ''

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
}, { immediate: true })

onMounted(() => fetchPushSubscriberCount())

async function save() {
  saving.value = true
  try {
    const settingsMap: Record<string, unknown> = {
      'email.provider': email.provider,
      'email.from_address': email.fromAddress,
      'email.resend_api_key': email.resendApiKey,
      'email.brevo_api_key': email.brevoApiKey,
      'email.zepto_api_key': email.zeptoApiKey,
      'email.smtp_host': email.smtpHost,
      'email.smtp_port': email.smtpPort,
      'email.smtp_user': email.smtpUser,
      'email.smtp_pass': email.smtpPass,
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
      'payments.paddle_webhook_public_key': payments.paddleWebhookPublicKey,
    }
    await $fetch('/api/v1/settings', {
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
      },
    })
    toast.add({ title: 'Settings saved', color: 'green' })
    await refresh()
  } catch {
    toast.add({ title: 'Failed to save settings', color: 'red' })
  } finally {
    saving.value = false
  }
}

// ── Security ──────────────────────────────────────────────────────────────────
const security = reactive({
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
})
const changingPassword = ref(false)
const passwordChangedSuccess = ref(false)
const redirectCountdown = ref(3)

async function changePassword() {
  if (!security.currentPassword || !security.newPassword) {
    toast.add({ title: 'Please fill in all password fields', color: 'red' })
    return
  }
  if (security.newPassword !== security.confirmPassword) {
    toast.add({ title: 'New passwords do not match', color: 'red' })
    return
  }
  if (security.newPassword.length < 8) {
    toast.add({ title: 'Password must be at least 8 characters long', color: 'red' })
    return
  }

  changingPassword.value = true
  try {
    await $fetch('/api/auth/change-password', {
      method: 'POST',
      body: {
        currentPassword: security.currentPassword,
        newPassword: security.newPassword,
        revokeOtherSessions: true,
      },
    })
    
    // Clear fields
    security.currentPassword = ''
    security.newPassword = ''
    security.confirmPassword = ''
    
    // Set success state
    passwordChangedSuccess.value = true
    toast.add({ title: 'Password updated successfully!', color: 'green' })
    
    // Set a countdown to sign out and log back in
    const interval = setInterval(() => {
      redirectCountdown.value--
      if (redirectCountdown.value <= 0) {
        clearInterval(interval)
        auth.signOut()
      }
    }, 1000)
  } catch (err: unknown) {
    const errMsg = (err as { data?: { message?: string } })?.data?.message ?? 'Failed to update password. Verify your current password.'
    toast.add({ title: errMsg, color: 'red' })
  } finally {
    changingPassword.value = false
  }
}

// ── Danger zone ───────────────────────────────────────────────────────────────
const deleteConfirm = ref('')
const deleting = ref(false)

async function deleteSite() {
  if (deleteConfirm.value !== data.value?.site.name) return
  deleting.value = true
  try {
    // Super admin endpoint
    await $fetch(`/api/v1/admin/sites/${data.value?.site.id}`, { method: 'DELETE' })
    await navigateTo('/setup')
  } finally {
    deleting.value = false
  }
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

        <!-- General -->
        <template v-if="active === 'General'">
          <UCard>
            <template #header><p class="text-sm font-semibold text-gray-900 dark:text-white">General settings</p></template>
            <div class="space-y-4">
              <UFormField label="Site name">
                <UInput v-model="general.name" placeholder="My Site" />
              </UFormField>
              <UFormField label="Primary domain" hint="The primary domain this site runs on (e.g. nuxflow.dev)">
                <UInput v-model="general.domain" placeholder="example.com" />
              </UFormField>
              <UFormField label="Notification email" hint="The email address where contact form submissions will be sent. Falls back to your admin email address if empty.">
                <UInput v-model="general.notificationEmail" type="email" placeholder="you@domain.com" />
              </UFormField>
              <UFormField label="Default locale">
                <USelect v-model="general.locale" :items="localeOptions" class="w-full" />
              </UFormField>
              <UFormField label="Timezone">
                <USelect v-model="general.timezone" :items="timezones" class="w-full" />
              </UFormField>
              <UFormField label="Site mode">
                <USelect
                  v-model="general.status"
                  :items="[{ label: 'Active', value: 'active' }, { label: 'Maintenance mode', value: 'maintenance' }]"
                  class="w-full"
                />
                <p class="mt-1 text-xs text-gray-400">Maintenance mode shows a holding page to visitors.</p>
              </UFormField>

              <div class="flex items-start justify-between gap-4 pt-2">
                <div>
                  <p class="text-sm font-medium text-gray-900 dark:text-white">Public registration</p>
                  <p class="mt-0.5 text-xs text-gray-400">Allow visitors to create their own accounts on the public website. Required for self-service memberships.</p>
                </div>
                <USwitch v-model="general.allowPublicRegistration" />
              </div>
            </div>
            <template #footer>
              <div class="flex justify-end">
                <UButton :loading="saving" @click="save">Save changes</UButton>
              </div>
            </template>
          </UCard>
        </template>

        <!-- Appearance -->
        <template v-if="active === 'Appearance'">
          <UAlert
            icon="i-lucide-palette"
            color="primary"
            variant="soft"
            title="Colour scheme, accent colour &amp; body font"
            description="These appearance settings live under Themes → Appearance alongside your active theme controls."
          >
            <template #description>
              These appearance settings live under
              <NuxtLink to="/admin/themes" class="underline font-medium">Themes → Appearance</NuxtLink>
              alongside your active theme controls.
            </template>
          </UAlert>

          <UCard>
            <template #header>
              <p class="text-sm font-semibold text-gray-900 dark:text-white">Site logo</p>
              <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Shown in the header instead of the site name. Upload an SVG or PNG with a transparent background — max height 40 px looks best.</p>
            </template>
            <div class="flex items-center gap-4">
              <div class="w-32 h-14 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex items-center justify-center overflow-hidden shrink-0 px-2">
                <img v-if="appearance.logoUrl" :src="appearance.logoUrl" alt="Current logo" class="max-h-10 max-w-full object-contain">
                <span v-else class="text-xs text-gray-400 dark:text-gray-500">No logo set</span>
              </div>
              <div class="space-y-2">
                <label class="cursor-pointer">
                  <UButton as="span" variant="outline" icon="i-lucide-upload" :loading="uploadingLogo" size="sm">
                    {{ appearance.logoUrl ? 'Replace logo' : 'Upload logo' }}
                  </UButton>
                  <input type="file" accept=".png,.svg,.jpg,.jpeg,.webp" class="sr-only" @change="uploadLogo">
                </label>
                <UButton
                  v-if="appearance.logoUrl"
                  variant="ghost"
                  color="red"
                  icon="i-lucide-trash-2"
                  size="sm"
                  @click="removeLogo"
                >
                  Remove logo
                </UButton>
              </div>
            </div>
          </UCard>

          <UCard>
            <template #header><p class="text-sm font-semibold text-gray-900 dark:text-white">Favicon</p></template>
            <div class="space-y-4">
              <p class="text-sm text-gray-500 dark:text-gray-400">The icon shown in browser tabs and bookmarks. Upload a square PNG, SVG, or ICO file — 256×256 px or larger recommended.</p>

              <div class="flex items-center gap-4">
                <div class="w-14 h-14 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex items-center justify-center overflow-hidden shrink-0">
                  <img v-if="appearance.faviconUrl" :src="appearance.faviconUrl" alt="Current favicon" class="w-10 h-10 object-contain">
                  <img v-else src="/favicon.svg" alt="Default favicon" class="w-10 h-10 object-contain">
                </div>
                <div class="space-y-2">
                  <label class="cursor-pointer">
                    <UButton
                      as="span"
                      variant="outline"
                      icon="i-lucide-upload"
                      :loading="uploadingFavicon"
                      size="sm"
                    >
                      {{ appearance.faviconUrl ? 'Replace' : 'Upload favicon' }}
                    </UButton>
                    <input type="file" accept=".png,.svg,.ico,.jpg,.jpeg,.webp" class="sr-only" @change="uploadFavicon">
                  </label>
                  <UButton
                    v-if="appearance.faviconUrl"
                    variant="ghost"
                    color="red"
                    icon="i-lucide-trash-2"
                    size="sm"
                    @click="removeFavicon"
                  >
                    Remove custom favicon
                  </UButton>
                </div>
              </div>
            </div>
          </UCard>

          <UCard>
            <template #header><p class="text-sm font-semibold text-gray-900 dark:text-white">Frontend header</p></template>
            <div class="space-y-5">
              <div class="flex items-start justify-between gap-4">
                <div>
                  <p class="text-sm font-medium text-gray-900 dark:text-white">Show header bar</p>
                  <p class="mt-0.5 text-xs text-gray-400">Displays the site name and navigation bar at the top of every public page.</p>
                </div>
                <USwitch v-model="appearance.showHeader" />
              </div>
              <div class="flex items-start justify-between gap-4">
                <div>
                  <p class="text-sm font-medium text-gray-900 dark:text-white">Show search icon</p>
                  <p class="mt-0.5 text-xs text-gray-400">Displays a search icon in the header that links to the /search page.</p>
                </div>
                <USwitch v-model="appearance.showSearch" />
              </div>
              <div class="flex items-start justify-between gap-4">
                <div>
                  <p class="text-sm font-medium text-gray-900 dark:text-white">Sticky header</p>
                  <p class="mt-0.5 text-xs text-gray-400">Keeps the header fixed at the top while scrolling. Disable to let it scroll away with the page.</p>
                </div>
                <USwitch v-model="appearance.showStickyHeader" />
              </div>
              <div class="flex items-start justify-between gap-4">
                <div>
                  <p class="text-sm font-medium text-gray-900 dark:text-white">Logo size</p>
                  <p class="mt-0.5 text-xs text-gray-400">Height of the logo image in the header. Has no effect when no logo is uploaded.</p>
                </div>
                <USelect v-model="appearance.logoSize" :items="logoSizeOptions" class="w-40" />
              </div>
            </div>
            <template #footer>
              <div class="flex justify-end">
                <UButton :loading="saving" @click="save">Save changes</UButton>
              </div>
            </template>
          </UCard>

          <UCard>
            <template #header>
              <p class="text-sm font-semibold text-gray-900 dark:text-white">Custom code</p>
              <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Inject analytics scripts, chat widgets, or any other HTML into your public pages. Only paste code from trusted sources.</p>
            </template>
            <div class="space-y-5">
              <UFormField label="Head code" hint="Injected before </head> — use for scripts that must load early (analytics, fonts).">
                <textarea
                  v-model="appearance.customHeadHtml"
                  rows="5"
                  placeholder="<!-- e.g. Google Analytics, Meta Pixel -->"
                  class="w-full px-3 py-2 text-xs font-mono rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-y"
                />
              </UFormField>
              <UFormField label="Body code" hint="Injected before </body> — use for chat widgets or deferred scripts.">
                <textarea
                  v-model="appearance.customBodyHtml"
                  rows="5"
                  placeholder="<!-- e.g. Intercom, Crisp, HubSpot -->"
                  class="w-full px-3 py-2 text-xs font-mono rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-y"
                />
              </UFormField>
            </div>
            <template #footer>
              <div class="flex justify-end">
                <UButton :loading="saving" @click="save">Save changes</UButton>
              </div>
            </template>
          </UCard>
        </template>

        <!-- Email -->
        <template v-if="active === 'Email'">
          <UCard>
            <template #header><p class="text-sm font-semibold text-gray-900 dark:text-white">Email delivery</p></template>
            <div class="space-y-4">
              <UFormField label="Provider">
                <USelect v-model="email.provider" :items="emailProviderOptions" class="w-full" />
              </UFormField>

              <template v-if="email.provider !== 'console'">
                <UFormField label="From address" :hint="`Optional — defaults to noreply@${general.domain || 'yourdomain.com'}`">
                  <UInput v-model="email.fromAddress" type="email" placeholder="noreply@yourdomain.com" />
                </UFormField>
              </template>

              <template v-if="email.provider === 'resend'">
                <UFormField label="Resend API key">
                  <UInput v-model="email.resendApiKey" type="password" placeholder="re_…" />
                </UFormField>
              </template>

              <template v-if="email.provider === 'brevo'">
                <UFormField label="Brevo API key">
                  <UInput v-model="email.brevoApiKey" type="password" placeholder="xkeysib-…" />
                </UFormField>
              </template>

              <template v-if="email.provider === 'zepto'">
                <UFormField label="ZeptoMail API key">
                  <UInput v-model="email.zeptoApiKey" type="password" placeholder="Zoho-enczapikey …" />
                </UFormField>
              </template>

              <template v-if="email.provider === 'smtp'">
                <UFormField label="SMTP host">
                  <UInput v-model="email.smtpHost" placeholder="smtp.example.com" />
                </UFormField>
                <div class="grid grid-cols-2 gap-3">
                  <UFormField label="Port">
                    <UInput v-model="email.smtpPort" type="number" :min="1" :max="65535" placeholder="587" />
                  </UFormField>
                  <UFormField label="Username">
                    <UInput v-model="email.smtpUser" placeholder="user@example.com" />
                  </UFormField>
                </div>
                <UFormField label="Password">
                  <UInput v-model="email.smtpPass" type="password" />
                </UFormField>
                <p class="text-xs text-gray-400">On Cloudflare Workers, SMTP is sent via MailChannels relay.</p>
              </template>

              <template v-if="email.provider === 'console'">
                <p class="text-sm text-gray-400">Emails are logged to the server console. Use for local development only.</p>
              </template>

              <UDivider />

              <div class="space-y-3">
                <p class="text-sm font-medium text-gray-700 dark:text-gray-300">Send a test email</p>
                <div class="flex gap-2">
                  <UInput
                    v-model="emailTestAddress"
                    type="email"
                    placeholder="you@example.com"
                    class="flex-1"
                  />
                  <UButton
                    :loading="testingEmail"
                    variant="outline"
                    icon="i-lucide-send"
                    @click="sendTestEmail"
                  >
                    Send test
                  </UButton>
                </div>
                <p v-if="emailTestResult" :class="emailTestResult.ok ? 'text-green-600 dark:text-green-400' : 'text-red-500'" class="text-sm">
                  {{ emailTestResult.message }}
                </p>
              </div>
            </div>
            <template #footer>
              <div class="flex justify-end">
                <UButton :loading="saving" @click="save">Save changes</UButton>
              </div>
            </template>
          </UCard>
        </template>

        <!-- Payments -->
        <template v-if="active === 'Payments'">
          <UCard>
            <template #header>
              <div class="flex items-center justify-between">
                <p class="text-sm font-semibold text-gray-900 dark:text-white">Membership signups</p>
                <UBadge v-if="payments.signupsDisabled" color="orange" variant="subtle" size="xs">Signups paused</UBadge>
              </div>
            </template>
            <div class="space-y-4">
              <div class="flex items-start justify-between gap-4">
                <div>
                  <p class="text-sm font-medium text-gray-900 dark:text-white">Pause new signups</p>
                  <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    Disables checkout for all membership tiers site-wide. Existing subscribers are unaffected.
                  </p>
                </div>
                <USwitch v-model="payments.signupsDisabled" />
              </div>
              <UFormField v-if="payments.signupsDisabled" label="Message shown to visitors">
                <UInput
                  v-model="payments.signupsDisabledMessage"
                  placeholder="New signups are temporarily paused."
                  class="w-full"
                />
              </UFormField>
            </div>
            <template #footer>
              <div class="flex justify-end">
                <UButton :loading="saving" @click="save">Save changes</UButton>
              </div>
            </template>
          </UCard>

          <UCard>
            <template #header><p class="text-sm font-semibold text-gray-900 dark:text-white">Payment gateway settings</p></template>
            <div class="space-y-6">
              <p class="text-sm text-gray-500 dark:text-gray-400">
                Configure payment gateways for paid membership subscriptions. Enabling Stripe allows automated syncing of membership tiers.
              </p>

              <!-- Stripe settings -->
              <div class="space-y-4">
                <div class="flex items-center gap-2 border-b border-gray-100 dark:border-gray-800 pb-2">
                  <UIcon name="i-lucide-credit-card" class="w-5 h-5 text-primary-500" />
                  <h3 class="text-sm font-semibold text-gray-900 dark:text-white">Stripe</h3>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <UFormField label="Stripe Secret Key">
                    <UInput v-model="payments.stripeSecretKey" type="password" placeholder="sk_live_..." class="w-full" />
                  </UFormField>
                  <UFormField label="Stripe Webhook Secret">
                    <UInput v-model="payments.stripeWebhookSecret" type="password" placeholder="whsec_..." class="w-full" />
                  </UFormField>
                </div>
                <p class="text-xs text-gray-400">
                  To automatically update subscriptions, add a webhook in Stripe dashboard pointing to: 
                  <code class="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded font-mono break-all select-all">
                    https://{{ general.domain || 'yourdomain.com' }}/api/v1/memberships/webhooks/stripe
                  </code>
                </p>
              </div>

              <!-- Lemon Squeezy settings -->
              <div class="space-y-4 pt-2">
                <div class="flex items-center gap-2 border-b border-gray-100 dark:border-gray-800 pb-2">
                  <UIcon name="i-lucide-wallet" class="w-5 h-5 text-primary-500" />
                  <h3 class="text-sm font-semibold text-gray-900 dark:text-white">Lemon Squeezy</h3>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <UFormField label="Lemon Squeezy API Key">
                    <UInput v-model="payments.lsApiKey" type="password" placeholder="eyJ..." class="w-full" />
                  </UFormField>
                  <UFormField label="Lemon Squeezy Webhook Secret">
                    <UInput v-model="payments.lsWebhookSecret" type="password" placeholder="Secret..." class="w-full" />
                  </UFormField>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <UFormField label="Lemon Squeezy Store ID">
                    <UInput v-model="payments.lsStoreId" placeholder="e.g. 12345" class="w-full" />
                  </UFormField>
                </div>
                <p class="text-xs text-gray-400">
                  Webhook URL for Lemon Squeezy dashboard: 
                  <code class="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded font-mono break-all select-all">
                    https://{{ general.domain || 'yourdomain.com' }}/api/v1/memberships/webhooks/lemonsqueezy
                  </code>
                </p>
              </div>

              <!-- Paddle settings -->
              <div class="space-y-4 pt-2">
                <div class="flex items-center gap-2 border-b border-gray-100 dark:border-gray-800 pb-2">
                  <UIcon name="i-lucide-credit-card" class="w-5 h-5 text-primary-500" />
                  <h3 class="text-sm font-semibold text-gray-900 dark:text-white">Paddle</h3>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <UFormField label="Paddle API Key">
                    <UInput v-model="payments.paddleApiKey" type="password" placeholder="Live_..." class="w-full" />
                  </UFormField>
                  <UFormField label="Paddle Webhook Public Key" hint="Paddle sends webhook signatures signed using a public/private keypair">
                    <UTextarea v-model="payments.paddleWebhookPublicKey" placeholder="-----BEGIN PUBLIC KEY-----..." class="w-full font-mono text-xs" :rows="3" />
                  </UFormField>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <UFormField label="Paddle Vendor/Merchant ID">
                    <UInput v-model="payments.paddleVendorId" placeholder="e.g. 98765" class="w-full" />
                  </UFormField>
                </div>
                <p class="text-xs text-gray-400">
                  Webhook URL for Paddle dashboard: 
                  <code class="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded font-mono break-all select-all">
                    https://{{ general.domain || 'yourdomain.com' }}/api/v1/memberships/webhooks/paddle
                  </code>
                </p>
              </div>

            </div>
            <template #footer>
              <div class="flex justify-end">
                <UButton :loading="saving" @click="save">Save changes</UButton>
              </div>
            </template>
          </UCard>
        </template>

        <!-- Media -->
        <template v-if="active === 'Media'">
          <UCard>
            <template #header>
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-video" class="w-4 h-4 text-primary-500" />
                <p class="text-sm font-semibold text-gray-900 dark:text-white">Cloudflare Stream</p>
              </div>
              <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">Adaptive-bitrate video hosting for the Videos library. Requires a Cloudflare account with Stream enabled.</p>
            </template>
            <div class="space-y-4">
              <UFormField label="Cloudflare Account ID" hint="Found in the Cloudflare dashboard sidebar under your profile">
                <UInput v-model="cloudflare.accountId" placeholder="e.g. abc123def456..." class="font-mono" />
              </UFormField>
              <UFormField label="Stream API Token" hint="Create a token with Stream:Edit permission at dash.cloudflare.com → My Profile → API Tokens">
                <UInput v-model="cloudflare.streamToken" type="password" placeholder="••••••••" />
              </UFormField>
            </div>
            <template #footer>
              <div class="flex items-center justify-between">
                <p class="text-xs text-gray-400">
                  Tokens are encrypted at rest using AES-GCM. Account ID is shared with Cloudflare Images below.
                </p>
                <UButton :loading="saving" @click="save">Save</UButton>
              </div>
            </template>
          </UCard>

          <UCard>
            <template #header>
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-image" class="w-4 h-4 text-primary-500" />
                <p class="text-sm font-semibold text-gray-900 dark:text-white">Cloudflare Images</p>
              </div>
              <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">Global CDN image hosting for the Media library. When configured, images are served from Cloudflare's edge instead of stored as base64.</p>
            </template>
            <div class="space-y-4">
              <UFormField label="Images API Token" hint="Create a token with Cloudflare Images:Edit permission">
                <UInput v-model="cloudflare.imagesToken" type="password" placeholder="••••••••" />
              </UFormField>
              <UFormField label="Images Delivery URL" hint="Your account's image delivery subdomain, e.g. https://imagedelivery.net/abc123">
                <UInput v-model="cloudflare.imagesDeliveryUrl" placeholder="https://imagedelivery.net/..." />
              </UFormField>
            </div>
            <template #footer>
              <div class="flex justify-end">
                <UButton :loading="saving" @click="save">Save</UButton>
              </div>
            </template>
          </UCard>

          <UAlert
            icon="i-lucide-info"
            color="blue"
            variant="soft"
            title="How to get these credentials"
          >
            <template #description>
              <ol class="list-decimal list-inside space-y-1 text-xs mt-1">
                <li><strong>Account ID</strong> — visible in the right sidebar of any Cloudflare dashboard page.</li>
                <li><strong>Stream API Token</strong> — Cloudflare dashboard → My Profile → API Tokens → Create Token → use the "Cloudflare Stream" template.</li>
                <li><strong>Images API Token</strong> — same flow, use the "Cloudflare Images" template.</li>
                <li><strong>Images Delivery URL</strong> — Cloudflare dashboard → Images → Overview → your delivery subdomain (e.g. <code class="font-mono">https://imagedelivery.net/your-account-hash</code>).</li>
              </ol>
            </template>
          </UAlert>
        </template>

        <!-- Integrations -->
        <template v-if="active === 'Integrations'">
          <UCard>
            <template #header><p class="text-sm font-semibold text-gray-900 dark:text-white">Cloudflare Turnstile</p></template>
            <div class="space-y-4">
              <UFormField label="Site key" hint="Public key shown to visitors">
                <UInput v-model="integrations.turnstileSiteKey" placeholder="0x4AAA…" />
              </UFormField>
              <p class="text-xs text-gray-400">
                Secret key must be set via <code class="bg-gray-100 dark:bg-gray-800 px-1 rounded">CLOUDFLARE_TURNSTILE_SECRET_KEY</code> environment variable.
              </p>
            </div>
            <template #footer>
              <div class="flex justify-end">
                <UButton :loading="saving" @click="save">Save changes</UButton>
              </div>
            </template>
          </UCard>

        </template>

        <!-- AI Settings -->
        <template v-if="active === 'AI Settings'">
          <UCard>
            <template #header><p class="text-sm font-semibold text-gray-900 dark:text-white">AI Configuration</p></template>
            <div class="space-y-4">
              <UFormField label="Provider">
                <USelect v-model="ai.provider" :items="aiProviderOptions" class="w-full" />
              </UFormField>

              <template v-if="ai.provider === 'openai'">
                <UFormField label="OpenAI API Key">
                  <UInput v-model="ai.openaiApiKey" type="password" placeholder="sk-..." />
                </UFormField>
              </template>

              <template v-if="ai.provider === 'anthropic'">
                <UFormField label="Anthropic API Key">
                  <UInput v-model="ai.anthropicApiKey" type="password" placeholder="sk-ant-..." />
                </UFormField>
              </template>

              <template v-if="ai.provider === 'gemini'">
                <UFormField label="Google Gemini API Key">
                  <UInput v-model="ai.geminiApiKey" type="password" placeholder="AIza..." />
                </UFormField>
              </template>

              <template v-if="ai.provider === 'deepseek'">
                <UFormField label="DeepSeek API Key">
                  <UInput v-model="ai.deepseekApiKey" type="password" placeholder="sk-..." />
                </UFormField>
              </template>

              <template v-if="ai.provider === 'ollama'">
                <UFormField label="Ollama Base URL" hint="Default: http://localhost:11434">
                  <UInput v-model="ai.ollamaBaseUrl" placeholder="http://localhost:11434" />
                </UFormField>
                <UFormField label="Ollama Model" hint="Default: llama3">
                  <UInput v-model="ai.ollamaModel" placeholder="llama3" />
                </UFormField>
              </template>
            </div>
            <template #footer>
              <div class="flex justify-end">
                <UButton :loading="saving" @click="save">Save changes</UButton>
              </div>
            </template>
          </UCard>
        </template>

        <!-- Push notifications -->
        <template v-if="active === 'Push'">

          <!-- VAPID keys -->
          <UCard>
            <template #header>
              <div class="flex items-center justify-between">
                <p class="text-sm font-semibold text-gray-900 dark:text-white">VAPID keys</p>
                <UBadge v-if="push.vapidPublicKey" color="green" variant="soft">Configured</UBadge>
                <UBadge v-else color="gray" variant="soft">Not configured</UBadge>
              </div>
            </template>
            <div class="space-y-4">
              <p class="text-sm text-gray-500 dark:text-gray-400">
                VAPID keys authenticate your server with browser push services. Generate once and leave them — regenerating invalidates all existing subscriber subscriptions.
              </p>
              <div v-if="push.vapidPublicKey" class="space-y-2">
                <p class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Public key</p>
                <p class="text-xs font-mono break-all bg-gray-50 dark:bg-gray-800 rounded-lg p-2 text-gray-700 dark:text-gray-300 select-all">{{ push.vapidPublicKey }}</p>
                <p class="text-xs text-gray-400">{{ pushSubscriberCount }} active subscriber{{ pushSubscriberCount !== 1 ? 's' : '' }}</p>
              </div>
              <div class="flex gap-2">
                <UButton
                  v-if="!push.vapidPublicKey"
                  icon="i-lucide-key"
                  :loading="generatingVapid"
                  @click="generateVapidKeys"
                >
                  Generate keys
                </UButton>
                <UButton
                  v-else
                  icon="i-lucide-refresh-cw"
                  variant="outline"
                  color="red"
                  :loading="generatingVapid"
                  @click="generateVapidKeys"
                >
                  Regenerate keys
                </UButton>
              </div>
            </div>
          </UCard>

          <!-- Event toggles -->
          <UCard>
            <template #header>
              <p class="text-sm font-semibold text-gray-900 dark:text-white">Notification events</p>
            </template>
            <div class="space-y-5">
              <div class="flex items-start justify-between gap-4">
                <div>
                  <p class="text-sm font-medium text-gray-900 dark:text-white">New content published</p>
                  <p class="text-xs text-gray-400 mt-0.5">Broadcast to all subscribers when a content item is first published.</p>
                </div>
                <USwitch v-model="push.eventsContentPublished" :disabled="!push.vapidPublicKey" />
              </div>
              <UDivider />
              <div class="flex items-start justify-between gap-4">
                <div>
                  <p class="text-sm font-medium text-gray-900 dark:text-white">Payment confirmation</p>
                  <p class="text-xs text-gray-400 mt-0.5">Notify the member when their subscription is activated.</p>
                </div>
                <USwitch v-model="push.eventsPaymentConfirmation" :disabled="!push.vapidPublicKey" />
              </div>
              <UDivider />
              <div class="flex items-start justify-between gap-4">
                <div>
                  <p class="text-sm font-medium text-gray-900 dark:text-white">Form submission confirmation</p>
                  <p class="text-xs text-gray-400 mt-0.5">Notify the logged-in member after they submit a contact form.</p>
                </div>
                <USwitch v-model="push.eventsFormSubmission" :disabled="!push.vapidPublicKey" />
              </div>
            </div>
            <template #footer>
              <div class="flex justify-end">
                <UButton :loading="saving" :disabled="!push.vapidPublicKey" @click="save">Save changes</UButton>
              </div>
            </template>
          </UCard>

          <!-- Test and manual broadcast -->
          <UCard>
            <template #header>
              <p class="text-sm font-semibold text-gray-900 dark:text-white">Send notification</p>
            </template>
            <div class="space-y-4">
              <div class="flex items-center justify-between gap-4">
                <div>
                  <p class="text-sm font-medium text-gray-900 dark:text-white">Test push</p>
                  <p class="text-xs text-gray-400 mt-0.5">Sends a test notification to your own browser (you must be subscribed).</p>
                </div>
                <UButton
                  variant="outline"
                  icon="i-lucide-send"
                  size="sm"
                  :loading="sendingTestPush"
                  :disabled="!push.vapidPublicKey"
                  @click="sendTestPush"
                >
                  Send test
                </UButton>
              </div>

              <UDivider />

              <p class="text-sm font-medium text-gray-900 dark:text-white">Broadcast to all subscribers</p>
              <UFormField label="Title">
                <UInput v-model="broadcastTitle" placeholder="Notification title" :disabled="!push.vapidPublicKey" />
              </UFormField>
              <UFormField label="Message">
                <UTextarea v-model="broadcastBody" placeholder="Notification body text" :disabled="!push.vapidPublicKey" />
              </UFormField>
              <UFormField label="Link (optional)" hint="Absolute path e.g. /blog/my-post">
                <UInput v-model="broadcastUrl" placeholder="https://yoursite.com/page" :disabled="!push.vapidPublicKey" />
              </UFormField>
              <div class="flex justify-end">
                <UButton
                  icon="i-lucide-megaphone"
                  :loading="broadcasting"
                  :disabled="!push.vapidPublicKey || !broadcastTitle || !broadcastBody"
                  @click="sendBroadcast"
                >
                  Broadcast
                </UButton>
              </div>
            </div>
          </UCard>

        </template>

        <!-- Security -->
        <template v-if="active === 'Security'">
          <UAlert
            v-if="passwordChangedSuccess"
            icon="i-lucide-circle-check"
            color="green"
            variant="soft"
            title="Password updated successfully!"
            :description="`Your password has been changed. Logging you out in ${redirectCountdown} seconds to re-authenticate with your new password...`"
            class="mb-4"
          />

          <UCard>
            <template #header>
              <p class="text-sm font-semibold text-gray-900 dark:text-white">Change password</p>
            </template>
            <div class="space-y-4">
              <p class="text-sm text-gray-500 dark:text-gray-400">
                Update your account password securely. Once changed, you will be signed out of any other active browser sessions.
              </p>
              
              <UFormField label="Current password" required>
                <UInput v-model="security.currentPassword" type="password" placeholder="••••••••" class="w-full" :disabled="passwordChangedSuccess" />
              </UFormField>
              
              <UFormField label="New password" required hint="Must be at least 8 characters">
                <UInput v-model="security.newPassword" type="password" placeholder="••••••••" class="w-full" :disabled="passwordChangedSuccess" />
              </UFormField>
              
              <UFormField label="Confirm new password" required>
                <UInput v-model="security.confirmPassword" type="password" placeholder="••••••••" class="w-full" :disabled="passwordChangedSuccess" />
              </UFormField>
            </div>
            <template #footer>
              <div class="flex justify-end">
                <UButton
                  :loading="changingPassword"
                  :disabled="passwordChangedSuccess || !security.currentPassword || !security.newPassword || security.newPassword !== security.confirmPassword"
                  @click="changePassword"
                >
                  Update password
                </UButton>
              </div>
            </template>
          </UCard>

          <ClientOnly>
            <div class="mt-6">
              <AdminPasskeyManager />
            </div>
            <div class="mt-6">
              <AdminLinkedAccountsManager />
            </div>
          </ClientOnly>
        </template>

        <!-- Danger zone -->
        <template v-if="active === 'Danger zone'">
          <UCard class="border border-red-200 dark:border-red-900">
            <template #header>
              <p class="text-sm font-semibold text-red-600 dark:text-red-400">Delete site</p>
            </template>
            <div class="space-y-4">
              <p class="text-sm text-gray-600 dark:text-gray-400">
                Permanently deletes this site and all its content, media, users, and settings. This action cannot be undone.
              </p>
              <UFormField :label="`Type &quot;${data?.site.name}&quot; to confirm`" class="w-full">
                <UInput v-model="deleteConfirm" :placeholder="data?.site.name" class="w-full" />
              </UFormField>
              <div class="flex items-center justify-between pt-2">
                <p class="text-xs text-gray-400">
                  <span v-if="deleteConfirm && deleteConfirm !== data?.site.name" class="text-red-400">Name does not match.</span>
                  <span v-else-if="deleteConfirm === data?.site.name && deleteConfirm" class="text-green-500">Name confirmed — you can now delete.</span>
                  <span v-else>The button below will activate once the name matches.</span>
                </p>
                <UButton
                  color="red"
                  :loading="deleting"
                  :disabled="deleteConfirm !== data?.site.name"
                  @click="deleteSite"
                >
                  Delete this site
                </UButton>
              </div>
            </div>
          </UCard>
        </template>

      </div>
    </div>
  </div>
</template>
