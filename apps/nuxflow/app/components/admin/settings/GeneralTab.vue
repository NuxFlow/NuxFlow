<script setup lang="ts">
import type { GeneralState } from '~/types/admin-settings'

const general = defineModel<GeneralState>('general', { required: true })
defineProps<{
  saving: boolean
  onSave: () => Promise<void>
}>()

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
</script>

<template>
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
        <UButton :loading="saving" @click="onSave">Save changes</UButton>
      </div>
    </template>
  </UCard>
</template>
