<script setup lang="ts">
import type { EmailState } from '~/types/admin-settings'

const email = defineModel<EmailState>('email', { required: true })
defineProps<{
  domain: string
  saving: boolean
  onSave: () => Promise<void>
}>()

const emailProviderOptions = [
  { label: 'Cloudflare Email (recommended)', value: 'cloudflare' },
  { label: 'Resend', value: 'resend' },
  { label: 'Brevo', value: 'brevo' },
  { label: 'ZeptoMail', value: 'zepto' },
  { label: 'MailChannels', value: 'smtp' },
  { label: 'Console (dev)', value: 'console' },
]

const { user: currentUser } = useUserSession()
const emailTestAddress = ref((currentUser.value as { email?: string })?.email ?? '')
const emailTestResult = ref<{ ok: boolean; message: string } | null>(null)
const testingEmail = ref(false)

// Not routed through useAdminAction(): the result (success or failure) is shown
// inline next to the button, not as a toast.
async function sendTestEmail() {
  emailTestResult.value = null
  testingEmail.value = true
  try {
    const res = await $fetch<{ message: string }>('/api/v1/settings/email-test', {
      method: 'POST',
      body: {
        sendTo: emailTestAddress.value || undefined,
        provider: email.value.provider,
        fromAddress: email.value.fromAddress || undefined,
        resendApiKey: email.value.resendApiKey || undefined,
        brevoApiKey: email.value.brevoApiKey || undefined,
        zeptoApiKey: email.value.zeptoApiKey || undefined,
      },
    })
    emailTestResult.value = { ok: true, message: res.message }
  } catch (e: unknown) {
    const msg = getErrorMessage(e, 'Test failed')
    emailTestResult.value = { ok: false, message: msg }
  } finally {
    testingEmail.value = false
  }
}
</script>

<template>
  <UCard>
    <template #header><p class="text-sm font-semibold text-gray-900 dark:text-white">Email delivery</p></template>
    <div class="space-y-4">
      <UFormField label="Provider">
        <USelect v-model="email.provider" :items="emailProviderOptions" class="w-full" />
      </UFormField>

      <template v-if="email.provider !== 'console'">
        <UFormField label="From address" :hint="`Optional — defaults to noreply@${domain || 'yourdomain.com'}`">
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

      <template v-if="email.provider === 'cloudflare'">
        <UAlert
          color="info"
          variant="soft"
          icon="i-lucide-info"
          description="No API key needed. Sends can go through even without it, but for reliable inbox delivery run `wrangler email sending enable <your-domain>` once (via Cloudflare's CLI or dashboard) for whichever domain your From address uses — it sets up the SPF/DKIM records recipients check."
        />
      </template>

      <template v-if="email.provider === 'smtp'">
        <UAlert
          color="warning"
          variant="soft"
          icon="i-lucide-triangle-alert"
          description="Sent via MailChannels' API, not a generic SMTP relay — there are no host/username/password to configure here. MailChannels' free anonymous relay for Cloudflare Workers requires an existing MailChannels account and DNS domain-lockdown records set up outside NuxFlow; most new setups won't have this. Cloudflare Email (above) needs no third-party account."
        />
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
        <UButton :loading="saving" @click="onSave">Save changes</UButton>
      </div>
    </template>
  </UCard>
</template>
