<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })

interface SiteData {
  site: { id: string; name: string; domain: string; locale: string; timezone: string; status: string }
  settings: Record<string, unknown>
}

const { data, refresh } = await useFetch<SiteData>('/api/v1/settings')
const { user: currentUser } = useUserSession()

const tabs = [
  { label: 'General', icon: 'i-lucide-settings' },
  { label: 'Appearance', icon: 'i-lucide-palette' },
  { label: 'Email', icon: 'i-lucide-mail' },
  { label: 'Integrations', icon: 'i-lucide-plug' },
  { label: 'Danger zone', icon: 'i-lucide-triangle-alert' },
]
const active = ref('General')

const saving = ref(false)
const toast = useToast()

// ── General ───────────────────────────────────────────────────────────────────
const general = reactive({
  name: '',
  domain: '',
  locale: 'en',
  timezone: 'UTC',
  status: 'active' as 'active' | 'maintenance',
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
  showColorToggle: true,
  faviconUrl: '',
})

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
const integrations = reactive({ turnstileSiteKey: '', analyticsId: '' })

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
  integrations.analyticsId = (s['integrations.analytics_id'] as string) ?? ''
  appearance.showHeader = (s['frontend.show_header'] as boolean | undefined) !== false
  appearance.showColorToggle = (s['frontend.show_color_toggle'] as boolean | undefined) !== false
  appearance.faviconUrl = (s['appearance.favicon_url'] as string) ?? ''
}, { immediate: true })

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
      'integrations.analytics_id': integrations.analyticsId,
      'frontend.show_header': appearance.showHeader,
      'frontend.show_color_toggle': appearance.showColorToggle,
      'appearance.favicon_url': appearance.faviconUrl || null,
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
            color="blue"
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
                  <p class="text-sm font-medium text-gray-900 dark:text-white">Show colour mode toggle</p>
                  <p class="mt-0.5 text-xs text-gray-400">Lets visitors switch between light and dark mode. Disable for sites with a fixed colour scheme.</p>
                </div>
                <USwitch v-model="appearance.showColorToggle" />
              </div>
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
                <UFormField label="From address" hint="Optional — defaults to noreply@nuxflow.app">
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
                    <UInput v-model="email.smtpPort" placeholder="587" />
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
          </UCard>

          <UCard>
            <template #header><p class="text-sm font-semibold text-gray-900 dark:text-white">Analytics</p></template>
            <div class="space-y-4">
              <UFormField label="Google Analytics measurement ID" hint="e.g. G-XXXXXXXXXX">
                <UInput v-model="integrations.analyticsId" placeholder="G-XXXXXXXXXX" />
              </UFormField>
            </div>
            <template #footer>
              <div class="flex justify-end">
                <UButton :loading="saving" @click="save">Save changes</UButton>
              </div>
            </template>
          </UCard>
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
