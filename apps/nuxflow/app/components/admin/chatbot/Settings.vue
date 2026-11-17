<script setup lang="ts">
import { CHATBOT_LIMITS, CHATBOT_SETTING_KEY, type ChatbotSettings, type ChatbotStatusResponse } from '#shared/lib/chatbot'
import type { ContentTypesResponse } from '#shared/lib/content-type-types'

const props = defineProps<{ status: ChatbotStatusResponse }>()
const emit = defineEmits<{ saved: [] }>()

const { run, isRunning, toast } = useAdminAction()
const { data: typeData } = await useFetch<ContentTypesResponse>('/api/v1/content-types')

const form = reactive<ChatbotSettings>(structuredClone(toRaw(props.status.settings)))
// Edited one per line.
const excludeText = ref(form.excludePaths.join('\n'))
const startersText = ref(form.starterQuestions.join('\n'))

const typeOptions = computed(() => (typeData.value?.types ?? []).map(t => ({ label: t.name, value: t.slug })))

const leadOptions = [
  { label: 'When it can\'t help, or the visitor asks for a person (recommended)', value: 'fallback' },
  { label: 'Also show a "Leave a message" link at all times', value: 'always' },
  { label: 'Never — point visitors to the contact details instead', value: 'off' },
]
const languageOptions = [
  { label: 'The visitor\'s language (recommended)', value: 'visitor' },
  { label: 'Always the site\'s language', value: 'site' },
]

async function save() {
  const settings: ChatbotSettings = {
    ...form,
    excludePaths: excludeText.value.split('\n').map(s => s.trim()).filter(Boolean),
    starterQuestions: startersText.value.split('\n').map(s => s.trim()).filter(Boolean),
  }
  const res = await run(() => $fetch<unknown>('/api/v1/settings', { method: 'PATCH', body: { settings: { [CHATBOT_SETTING_KEY]: settings } } }), { errorTitle: "Couldn't save the chatbot settings", key: 'save' })
  if (res === undefined) return
  toast.add({ title: 'Chatbot settings saved', description: 'Visitors see the change within a few minutes.', color: 'success' })
  emit('saved')
}
</script>

<template>
  <div class="space-y-4">
    <UCard>
      <template #header>
        <div class="flex items-center justify-between gap-4">
          <div>
            <h2 class="font-semibold">Chat bubble</h2>
            <p class="text-sm text-gray-500 dark:text-gray-400">Shown in the bottom corner of every page, except the ones you list below.</p>
          </div>
          <USwitch v-model="form.enabled" :disabled="!status.planIncluded" label="Show the chatbot" />
        </div>
      </template>
      <div class="space-y-4">
        <UFormField label="Name" required>
          <UInput v-model="form.name" :maxlength="CHATBOT_LIMITS.name" class="w-full" />
        </UFormField>
        <UFormField label="Greeting" hint="The first thing visitors see">
          <UTextarea v-model="form.greeting" :rows="2" :maxlength="CHATBOT_LIMITS.greeting" class="w-full" />
        </UFormField>
        <UFormField label="Starter questions" hint="Optional, one per line, up to 4 — tapped to ask">
          <UTextarea v-model="startersText" :rows="3" class="w-full" placeholder="What are your opening hours?&#10;Do you deliver?" />
        </UFormField>
        <UFormField label="Don't show on these pages" hint="Optional, one path per line, e.g. /shop">
          <UTextarea v-model="excludeText" :rows="2" class="w-full" />
        </UFormField>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <h2 class="font-semibold">What it says</h2>
      </template>
      <div class="space-y-4">
        <UFormField label="Instructions" hint="Optional: tone, what to mention, how to talk about prices…">
          <UTextarea v-model="form.instructions" :rows="5" :maxlength="CHATBOT_LIMITS.instructions" class="w-full" placeholder="Be warm and informal. Mention that first consultations are free. Never quote prices for weddings — ask them to get in touch." />
        </UFormField>
        <UFormField label="Topics it won't discuss" hint="Optional, one per line">
          <UTextarea v-model="form.avoid" :rows="2" :maxlength="CHATBOT_LIMITS.avoid" class="w-full" placeholder="Competitors&#10;Politics" />
        </UFormField>
        <USwitch v-model="form.strict" label="Only answer from this website's information" description="Recommended. Off, it may also use general knowledge — but never invents facts about your business." />
        <UFormField label="Reply in">
          <USelect v-model="form.language" :items="languageOptions" class="w-full" />
        </UFormField>
        <USwitch v-model="form.showSources" label="Link to the pages an answer came from" />
        <UFormField label="Messages per conversation" :hint="`${CHATBOT_LIMITS.minMessages}–${CHATBOT_LIMITS.maxMessages}`">
          <UInputNumber v-model="form.maxMessages" :min="CHATBOT_LIMITS.minMessages" :max="CHATBOT_LIMITS.maxMessages" />
        </UFormField>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <h2 class="font-semibold">What it learns from</h2>
      </template>
      <div class="space-y-4">
        <p class="text-sm text-gray-500 dark:text-gray-400">
          Your published, public pages and posts, your opening hours and contact details (Settings → Business), and what you add under Knowledge. Changes are picked up within a minute or two.
        </p>
        <UFormField label="Only these content types" hint="Leave empty for all of them">
          <USelectMenu v-model="form.contentTypes" :items="typeOptions" value-key="value" multiple placeholder="All content types" class="w-full" />
        </UFormField>
        <div class="space-y-2">
          <p class="text-sm font-medium">Live details</p>
          <p class="text-sm text-gray-500 dark:text-gray-400">Looked up the moment it answers, so it never quotes yesterday's price or a time that's gone.</p>
          <USwitch v-model="form.live.events" label="Upcoming events" />
          <USwitch v-model="form.live.products" label="Product prices and stock (when the shop is on)" />
          <USwitch v-model="form.live.appointments" label="Next free appointment times" />
        </div>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <h2 class="font-semibold">Taking details</h2>
      </template>
      <div class="space-y-4">
        <p class="text-sm text-gray-500 dark:text-gray-400">
          Details visitors leave arrive in your Inbox (Website chat) with the conversation, and editors and admins are notified. Reply from the Inbox to email them.
        </p>
        <UFormField label="Offer to take details">
          <USelect v-model="form.lead.mode" :items="leadOptions" class="w-full" />
        </UFormField>
        <template v-if="form.lead.mode !== 'off'">
          <USwitch v-model="form.lead.askPhone" label="Ask for a phone number too (optional for the visitor)" />
          <UFormField label="Privacy note" hint="Shown next to the form">
            <UInput v-model="form.lead.consentText" :maxlength="CHATBOT_LIMITS.consentText" class="w-full" />
          </UFormField>
        </template>
        <p class="text-xs text-gray-500">Conversations are kept for 30 days, then deleted. Mention the chat in your privacy policy.</p>
      </div>
    </UCard>

    <div class="flex justify-end">
      <UButton :loading="isRunning('save')" @click="save">Save</UButton>
    </div>
  </div>
</template>
