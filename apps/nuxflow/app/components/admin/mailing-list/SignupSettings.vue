<script setup lang="ts">
import { DEFAULT_SIGNUP_SETTINGS, type SignupSettings } from '#shared/lib/signup-prompt'

interface SettingsResponse {
  settings: SignupSettings
  email: { provider: string; canSendListEmail: boolean; brevoKeyConfigured: boolean }
}

const { run, isRunning, toast } = useAdminAction()
const { data } = await useFetch<SettingsResponse>('/api/v1/mailing-list/settings')

const form = reactive<SignupSettings>({ ...DEFAULT_SIGNUP_SETTINGS, ...(data.value?.settings ?? {}) })
// Edited as one path per line.
const excludeText = ref(form.excludePaths.join('\n'))
const brevoListText = ref(form.brevoListId ? String(form.brevoListId) : '')
const saving = computed(() => isRunning('save'))
const showImagePicker = ref(false)

const canSend = computed(() => data.value?.email.canSendListEmail ?? false)

// Double opt-in can't work without a provider that can send the email (and the server
// refuses to save it on) — show it off rather than a switch that can't be saved.
if (!canSend.value) form.doubleOptIn = false

const styleOptions = [
  { label: 'Corner slide-in (recommended)', value: 'slide-in' },
  { label: 'Centred popup (modal)', value: 'modal' },
]

const triggerOptions = [
  { label: 'When they\'re reading — part-way down a page, or on their second page (recommended)', value: 'engaged' },
  { label: 'When they go to leave (mouse heads for the tabs or close button)', value: 'exit' },
  { label: 'After a number of seconds', value: 'delay' },
]

async function save() {
  const body: SignupSettings = {
    ...form,
    excludePaths: excludeText.value.split('\n').map(s => s.trim()).filter(Boolean),
    brevoListId: brevoListText.value.trim() ? Number(brevoListText.value.trim()) : null,
  }
  const res = await run(() => $fetch<{ settings: SignupSettings }>('/api/v1/mailing-list/settings', { method: 'PUT', body }), { errorTitle: "Couldn't save signup settings", key: 'save' })
  if (!res) return
  Object.assign(form, res.settings)
  // Own success toast: it needs a description, which successTitle can't carry.
  toast.add({ title: 'Signup settings saved', description: 'Visitors see the change within a few minutes.', color: 'success' })
}
</script>

<template>
  <div class="space-y-4">
    <UCard>
      <template #header>
        <div class="flex items-center justify-between gap-4">
          <div>
            <h2 class="font-semibold">Signup popup</h2>
            <p class="text-sm text-gray-500 dark:text-gray-400">
              A small, polite prompt asking visitors to join your mailing list. It never shows to signed-in people or anyone who already signed up, waits until the cookie banner is answered, and stays away once closed.
            </p>
          </div>
          <USwitch v-model="form.popupEnabled" label="Show the popup" />
        </div>
      </template>

      <div class="space-y-4">
        <UFormField label="Heading" required>
          <UInput v-model="form.heading" maxlength="120" class="w-full" />
        </UFormField>
        <UFormField label="Text" hint="Optional">
          <UTextarea v-model="form.body" :rows="2" maxlength="500" class="w-full" />
        </UFormField>
        <UFormField label="Button label" required>
          <UInput v-model="form.buttonLabel" maxlength="40" class="w-full" />
        </UFormField>
        <UFormField label="Image" hint="Optional — shown above the form (not on phones in the slide-in)">
          <div class="flex gap-2">
            <UInput v-model="form.imageUrl" placeholder="https://… or pick from the media library" class="flex-1" />
            <UButton variant="outline" icon="i-lucide-image" @click="showImagePicker = true">Choose</UButton>
          </div>
        </UFormField>
        <USwitch v-model="form.collectName" label="Ask for their first name too" />
        <UFormField label="Consent wording" help="Shown under the form and saved with each signup as the record of what the person agreed to.">
          <UTextarea v-model="form.consentText" :rows="2" maxlength="500" class="w-full" />
        </UFormField>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <h2 class="font-semibold">When and where it appears</h2>
      </template>
      <div class="space-y-4">
        <UFormField label="Style" help="On phones it's always a small bar at the bottom of the screen — Google penalises full-screen popups on mobile.">
          <USelect v-model="form.style" :items="styleOptions" class="w-full" />
        </UFormField>
        <UFormField label="Show it">
          <USelect v-model="form.trigger" :items="triggerOptions" class="w-full" />
        </UFormField>
        <UFormField v-if="form.trigger !== 'delay'" label="How far down the page counts as reading (%)" help="Exit intent needs a mouse, so on phones and tablets it uses this instead.">
          <UInput v-model.number="form.scrollPercent" type="number" min="10" max="90" class="w-32" />
        </UFormField>
        <UFormField v-if="form.trigger === 'delay'" label="Seconds after the page opens" help="Asking within the first few seconds, before anyone has read anything, is what makes popups annoying — 30 or more works better.">
          <UInput v-model.number="form.delaySeconds" type="number" min="5" max="300" class="w-32" />
        </UFormField>
        <UFormField label="Once closed, stay away for (days)">
          <UInput v-model.number="form.hideDays" type="number" min="1" max="365" class="w-32" />
        </UFormField>
        <USwitch v-model="form.showOnMobile" label="Show on phones" />
        <UFormField label="Never show on these pages" help="One path per line. /shop also covers /shop/cart. A single / means the homepage only.">
          <UTextarea v-model="excludeText" :rows="3" placeholder="/contact&#10;/checkout" class="w-full font-mono text-sm" />
        </UFormField>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <h2 class="font-semibold">After signing up</h2>
      </template>
      <div class="space-y-4">
        <UAlert
          v-if="!canSend"
          color="warning"
          variant="subtle"
          icon="i-lucide-mail-warning"
          title="No email provider for list mail yet"
          description="Mailing-list email (including the confirmation email) only goes out through a third-party provider — Resend, Brevo or ZeptoMail — never Cloudflare. Set one up in Settings → Email to use double opt-in."
        />
        <USwitch
          v-model="form.doubleOptIn"
          :disabled="!canSend"
          label="Double opt-in: email a confirmation link first"
          description="Keeps mistyped and fake addresses off the list, and is expected in Germany and some other countries."
        />
        <UFormField label="Thank-you heading" required>
          <UInput v-model="form.successHeading" maxlength="120" class="w-full" />
        </UFormField>
        <UFormField label="Thank-you text" hint="Optional">
          <UTextarea v-model="form.successBody" :rows="2" maxlength="500" class="w-full" />
        </UFormField>
        <USeparator label="Something in return (optional)" />
        <p class="text-sm text-gray-500 dark:text-gray-400">
          A discount code, a free download, a trial — whatever you're offering. It's only shown after signing up{{ form.doubleOptIn ? ' and confirming' : '' }}, so it can't be found without joining.
        </p>
        <UFormField label="Text" hint="e.g. Your code: WELCOME10">
          <UTextarea v-model="form.rewardText" :rows="2" maxlength="500" class="w-full" />
        </UFormField>
        <div class="grid sm:grid-cols-2 gap-4">
          <UFormField label="Link" hint="e.g. a download">
            <UInput v-model="form.rewardUrl" placeholder="https://… or /page" class="w-full" />
          </UFormField>
          <UFormField label="Link button label">
            <UInput v-model="form.rewardLabel" placeholder="Get it now" maxlength="60" class="w-full" />
          </UFormField>
        </div>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <h2 class="font-semibold">Copy to Brevo (optional)</h2>
      </template>
      <div class="space-y-3">
        <p class="text-sm text-gray-500 dark:text-gray-400">
          To send newsletters with Brevo, enter the ID of a Brevo contact list and confirmed subscribers are added to it (and removed when they unsubscribe). Uses the Brevo API key from Settings → Email.
        </p>
        <UFormField label="Brevo list ID" :help="data?.email.brevoKeyConfigured ? undefined : 'Add a Brevo API key in Settings → Email first.'">
          <UInput v-model="brevoListText" inputmode="numeric" placeholder="e.g. 3" class="w-32" />
        </UFormField>
      </div>
    </UCard>

    <div class="flex justify-end">
      <UButton :loading="saving" @click="save">Save changes</UButton>
    </div>

    <UModal v-model:open="showImagePicker" title="Choose an image">
      <template #body>
        <EditorMediaPicker @select="(f: { url: string }) => { form.imageUrl = f.url; showImagePicker = false }" />
      </template>
    </UModal>
  </div>
</template>
