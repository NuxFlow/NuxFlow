<script setup lang="ts">
const site = defineModel<{ name: string; locale: string; timezone: string }>({ required: true })
const emit = defineEmits<{ next: [] }>()
</script>

<template>
  <div class="space-y-5">
    <div>
      <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Site details</h2>
      <p class="text-sm text-gray-500 mt-1">Tell us about your new site.</p>
    </div>

    <UFormField label="Site name" required>
      <UInput v-model="site.name" placeholder="My Awesome Site" class="w-full" @keyup.enter="site.name && emit('next')" />
    </UFormField>

    <UFormField label="Default language">
      <SiteLanguageSelect v-model="site.locale" />
    </UFormField>
    <UFormField label="Timezone">
      <SiteTimezoneSelect v-model="site.timezone" />
    </UFormField>

    <div class="flex justify-end pt-2">
      <UButton
        :disabled="!site.name"
        @click="emit('next')"
      >
        Continue
        <UIcon name="i-lucide-arrow-right" class="ml-1 w-4 h-4" />
      </UButton>
    </div>
  </div>
</template>
