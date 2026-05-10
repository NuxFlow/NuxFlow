<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })

interface SiteData {
  site: { id: string; name: string; domain: string; locale: string; timezone: string; status: string }
  settings: Record<string, unknown>
}

const { data, refresh } = await useFetch<SiteData>('/api/v1/settings')

const tabs = [
  { label: 'General', icon: 'i-lucide-settings' },
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

// ── Email ─────────────────────────────────────────────────────────────────────
const email = reactive({
  provider: 'console',
  resendApiKey: '',
  brevoApiKey: '',
  smtpHost: '',
  smtpPort: '587',
  smtpUser: '',
  smtpPass: '',
})

const emailProviderOptions = [
  { label: 'Console (dev)', value: 'console' },
  { label: 'Resend', value: 'resend' },
  { label: 'Brevo', value: 'brevo' },
  { label: 'SMTP / MailChannels', value: 'smtp' },
]

// ── Integrations ─────────────────────────────────────────────────────────────
const integrations = reactive({ turnstileSiteKey: '', analyticsId: '' })

// ── Populate from API ─────────────────────────────────────────────────────────
watch(data, (d) => {
  if (!d) return
  Object.assign(general, {
    name: d.site.name,
    locale: d.site.locale,
    timezone: d.site.timezone,
    status: d.site.status,
  })
  const s = d.settings
  email.provider = (s['email.provider'] as string) ?? 'console'
  email.resendApiKey = (s['email.resend_api_key'] as string) ?? ''
  email.brevoApiKey = (s['email.brevo_api_key'] as string) ?? ''
  email.smtpHost = (s['email.smtp_host'] as string) ?? ''
  email.smtpPort = (s['email.smtp_port'] as string) ?? '587'
  email.smtpUser = (s['email.smtp_user'] as string) ?? ''
  integrations.turnstileSiteKey = (s['integrations.turnstile_site_key'] as string) ?? ''
  integrations.analyticsId = (s['integrations.analytics_id'] as string) ?? ''
}, { immediate: true })

async function save() {
  saving.value = true
  try {
    const settingsMap: Record<string, unknown> = {
      'email.provider': email.provider,
      'email.resend_api_key': email.resendApiKey,
      'email.brevo_api_key': email.brevoApiKey,
      'email.smtp_host': email.smtpHost,
      'email.smtp_port': email.smtpPort,
      'email.smtp_user': email.smtpUser,
      'integrations.turnstile_site_key': integrations.turnstileSiteKey,
      'integrations.analytics_id': integrations.analyticsId,
    }
    await $fetch('/api/v1/settings', {
      method: 'PATCH',
      body: {
        name: general.name,
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
            <template #header><p class="text-sm font-semibold">General settings</p></template>
            <div class="space-y-4">
              <UFormField label="Site name">
                <UInput v-model="general.name" placeholder="My Site" />
              </UFormField>
              <UFormField label="Default locale">
                <USelect v-model="general.locale" :items="localeOptions" />
              </UFormField>
              <UFormField label="Timezone">
                <USelect v-model="general.timezone" :items="timezones" />
              </UFormField>
              <UFormField label="Site mode">
                <USelect
                  v-model="general.status"
                  :items="[{ label: 'Active', value: 'active' }, { label: 'Maintenance mode', value: 'maintenance' }]"
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

        <!-- Email -->
        <template v-if="active === 'Email'">
          <UCard>
            <template #header><p class="text-sm font-semibold">Email delivery</p></template>
            <div class="space-y-4">
              <UFormField label="Provider">
                <USelect v-model="email.provider" :items="emailProviderOptions" />
              </UFormField>

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
            <template #header><p class="text-sm font-semibold">Cloudflare Turnstile</p></template>
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
            <template #header><p class="text-sm font-semibold">Analytics</p></template>
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
              <UFormField :label="`Type &quot;${data?.site.name}&quot; to confirm`">
                <UInput v-model="deleteConfirm" :placeholder="data?.site.name" />
              </UFormField>
            </div>
            <template #footer>
              <div class="flex justify-end">
                <UButton
                  color="red"
                  :loading="deleting"
                  :disabled="deleteConfirm !== data?.site.name"
                  @click="deleteSite"
                >
                  Delete this site
                </UButton>
              </div>
            </template>
          </UCard>
        </template>

      </div>
    </div>
  </div>
</template>
