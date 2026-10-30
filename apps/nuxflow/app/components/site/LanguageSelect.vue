<script setup lang="ts">
import { SITE_LANGUAGES } from '#shared/lib/site-locale'

// A site's default language. Stored as a code ("en"), which also shapes translated URLs,
// so it's picked from a list — a code saved earlier that isn't listed stays selectable.
const model = defineModel<string>({ required: true })

const items = computed(() => {
  const list = SITE_LANGUAGES.map(l => ({ label: `${l.label} (${l.value})`, value: l.value }))
  if (model.value && !SITE_LANGUAGES.some(l => l.value === model.value)) list.push({ label: model.value, value: model.value })
  return list
})
</script>

<template>
  <USelect v-model="model" :items="items" class="w-full" />
</template>
