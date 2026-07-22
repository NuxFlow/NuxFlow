<script setup lang="ts">
const props = defineProps<{ contentItemId: string }>()
const emit = defineEmits<{
  translated: [id: string, locale: string]
  close: []
}>()

const loading = ref(false)
const error = ref('')

const commonLocales = [
  { label: 'Spanish (es)', value: 'es' },
  { label: 'French (fr)', value: 'fr' },
  { label: 'German (de)', value: 'de' },
  { label: 'Italian (it)', value: 'it' },
  { label: 'Portuguese (pt)', value: 'pt' },
  { label: 'Dutch (nl)', value: 'nl' },
  { label: 'Polish (pl)', value: 'pl' },
  { label: 'Japanese (ja)', value: 'ja' },
  { label: 'Chinese Simplified (zh-CN)', value: 'zh-CN' },
  { label: 'Chinese Traditional (zh-TW)', value: 'zh-TW' },
  { label: 'Korean (ko)', value: 'ko' },
  { label: 'Arabic (ar)', value: 'ar' },
  { label: 'Russian (ru)', value: 'ru' },
  { label: 'Hindi (hi)', value: 'hi' },
  { label: 'Custom…', value: '__custom__' },
]

const selectedLocale = ref('')
const customLocale = ref('')

const resolvedLocale = computed(() =>
  selectedLocale.value === '__custom__' ? customLocale.value.trim() : selectedLocale.value,
)

async function translate() {
  const locale = resolvedLocale.value
  if (!locale) {
    error.value = 'Please select or enter a target language.'
    return
  }
  loading.value = true
  error.value = ''
  try {
    const res = await $fetch<{ id: string; locale: string; updated: boolean }>('/api/v1/ai/translate', {
      method: 'POST',
      body: { contentItemId: props.contentItemId, targetLocale: locale },
    })
    emit('translated', res.id, res.locale)
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message
    error.value = msg || 'Translation failed. Please try again.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="space-y-4">
    <p class="text-sm text-gray-500 dark:text-gray-400">
      AI will translate all page content and create a separate draft content item linked to this source.
    </p>

    <UFormField label="Target language">
      <USelect
        v-model="selectedLocale"
        :items="commonLocales"
        placeholder="Select a language…"
      />
    </UFormField>

    <UFormField v-if="selectedLocale === '__custom__'" label="Custom locale code" hint="e.g. pt-BR, zh-TW">
      <UInput v-model="customLocale" placeholder="en" />
    </UFormField>

    <p v-if="error" class="text-sm text-red-500 flex items-center gap-1.5">
      <UIcon name="i-lucide-alert-circle" class="w-4 h-4" />
      {{ error }}
    </p>

    <UAlert
      icon="i-lucide-info"
      color="info"
      variant="soft"
      size="sm"
      description="The translation is created as a draft. Review it before publishing."
    />

    <div class="flex justify-end gap-2 pt-2">
      <UButton variant="ghost" @click="emit('close')">Cancel</UButton>
      <UButton
        icon="i-lucide-languages"
        :loading="loading"
        :disabled="!resolvedLocale"
        @click="translate"
      >
        Translate
      </UButton>
    </div>
  </div>
</template>
