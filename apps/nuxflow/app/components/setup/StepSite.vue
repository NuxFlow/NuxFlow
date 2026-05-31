<script setup lang="ts">
const props = defineProps<{
  modelValue: { name: string; domain: string; locale: string; timezone: string }
}>()
const emit = defineEmits<{
  'update:modelValue': [value: typeof props.modelValue]
  next: []
}>()

const local = reactive({ ...props.modelValue })
watch(local, (v) => emit('update:modelValue', { ...v }))

function autoFillDomain() {
  if (!local.domain && local.name) {
    local.domain = window.location.hostname
  }
}

const timezones = [
  { label: 'UTC', value: 'UTC' },
  { label: 'America/New_York (EST/EDT)', value: 'America/New_York' },
  { label: 'America/Chicago (CST/CDT)', value: 'America/Chicago' },
  { label: 'America/Denver (MST/MDT)', value: 'America/Denver' },
  { label: 'America/Los_Angeles (PST/PDT)', value: 'America/Los_Angeles' },
  { label: 'America/Anchorage (AKST)', value: 'America/Anchorage' },
  { label: 'Pacific/Honolulu (HST)', value: 'Pacific/Honolulu' },
  { label: 'America/Toronto', value: 'America/Toronto' },
  { label: 'America/Vancouver', value: 'America/Vancouver' },
  { label: 'America/Sao_Paulo', value: 'America/Sao_Paulo' },
  { label: 'America/Argentina/Buenos_Aires', value: 'America/Argentina/Buenos_Aires' },
  { label: 'Europe/London (GMT/BST)', value: 'Europe/London' },
  { label: 'Europe/Paris (CET/CEST)', value: 'Europe/Paris' },
  { label: 'Europe/Berlin', value: 'Europe/Berlin' },
  { label: 'Europe/Amsterdam', value: 'Europe/Amsterdam' },
  { label: 'Europe/Madrid', value: 'Europe/Madrid' },
  { label: 'Europe/Rome', value: 'Europe/Rome' },
  { label: 'Europe/Stockholm', value: 'Europe/Stockholm' },
  { label: 'Europe/Warsaw', value: 'Europe/Warsaw' },
  { label: 'Europe/Helsinki', value: 'Europe/Helsinki' },
  { label: 'Europe/Kyiv', value: 'Europe/Kyiv' },
  { label: 'Europe/Moscow', value: 'Europe/Moscow' },
  { label: 'Africa/Cairo', value: 'Africa/Cairo' },
  { label: 'Africa/Johannesburg', value: 'Africa/Johannesburg' },
  { label: 'Asia/Dubai', value: 'Asia/Dubai' },
  { label: 'Asia/Kolkata (IST)', value: 'Asia/Kolkata' },
  { label: 'Asia/Dhaka', value: 'Asia/Dhaka' },
  { label: 'Asia/Bangkok', value: 'Asia/Bangkok' },
  { label: 'Asia/Singapore', value: 'Asia/Singapore' },
  { label: 'Asia/Shanghai', value: 'Asia/Shanghai' },
  { label: 'Asia/Tokyo (JST)', value: 'Asia/Tokyo' },
  { label: 'Asia/Seoul', value: 'Asia/Seoul' },
  { label: 'Australia/Sydney', value: 'Australia/Sydney' },
  { label: 'Australia/Melbourne', value: 'Australia/Melbourne' },
  { label: 'Australia/Perth', value: 'Australia/Perth' },
  { label: 'Pacific/Auckland', value: 'Pacific/Auckland' },
]
</script>

<template>
  <div class="space-y-5">
    <div>
      <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Site details</h2>
      <p class="text-sm text-gray-500 mt-1">Tell us about your new site.</p>
    </div>

    <UFormField label="Site name" required>
      <UInput v-model="local.name" placeholder="My Awesome Site" @blur="autoFillDomain" />
    </UFormField>

    <UFormField label="Domain" required hint="The primary domain this site runs on">
      <UInput v-model="local.domain" placeholder="example.com" />
    </UFormField>

    <div class="grid grid-cols-2 gap-4">
      <UFormField label="Default language">
        <USelect v-model="local.locale" :items="[{ label: 'English', value: 'en' }]" />
      </UFormField>
      <UFormField label="Timezone">
        <USelect v-model="local.timezone" :items="timezones" />
      </UFormField>
    </div>

    <div class="flex justify-end pt-2">
      <UButton
        :disabled="!local.name || !local.domain"
        @click="emit('next')"
      >
        Continue
        <UIcon name="i-lucide-arrow-right" class="ml-1 w-4 h-4" />
      </UButton>
    </div>
  </div>
</template>
