<script setup lang="ts">
import type { AssistantSettingKey, AssistantSettingValue } from '#shared/lib/assistant'
import { appearanceCss, customizerCss, parseColorMode, parseCustomizerValues, siteFontsHref, type CustomizerState } from '#shared/lib/theme-customizer'

// A live preview of the site with the helper's suggested look-and-feel changes, before
// anything is saved. Same preview frame and the same CSS functions as the Visual
// Customizer, built from the site's saved look with only the suggested values changed.

const props = defineProps<{ changes: Partial<Record<AssistantSettingKey, AssistantSettingValue>> }>()
const open = defineModel<boolean>('open', { required: true })

const { data, error } = await useFetch<CustomizerState>('/api/v1/themes/customizer')
const device = ref<'desktop' | 'tablet' | 'mobile'>('desktop')

const preview = computed(() => {
  if (!data.value) return null
  const c = props.changes
  const values = parseCustomizerValues({
    ...data.value.values,
    ...(c['theme.dark_mode'] !== undefined ? { colorMode: parseColorMode(c['theme.dark_mode']) } : {}),
    ...(c['theme.primary_color'] !== undefined ? { primaryColor: c['theme.primary_color'] } : {}),
    ...(c['theme.font_sans'] !== undefined ? { bodyFont: c['theme.font_sans'] } : {}),
    ...(c['theme.font_heading'] !== undefined ? { headingFont: c['theme.font_heading'] } : {}),
  })
  return {
    // The customizer's own CSS only when it's what the live site uses.
    css: `${appearanceCss(values)}\n${data.value.live ? customizerCss(values) : ''}`,
    fontHref: siteFontsHref([values.bodyFont, values.headingFont]),
    colorMode: values.colorMode,
  }
})
</script>

<template>
  <UModal v-model:open="open" fullscreen title="Preview" description="Your site with the suggested change. Nothing is saved — close this and press Apply to keep it.">
    <template #body>
      <div class="flex flex-col h-full min-h-[60vh] -m-4 sm:-m-6">
        <div class="flex items-center gap-1 px-3 py-2 border-b border-gray-200 dark:border-gray-800">
          <UButton v-for="d in (['desktop', 'tablet', 'mobile'] as const)" :key="d" size="xs" :variant="device === d ? 'soft' : 'ghost'" color="neutral" class="capitalize" @click="device = d">{{ d }}</UButton>
        </div>
        <UAlert v-if="error" color="error" variant="soft" title="Couldn't load the preview" class="m-4" />
        <AdminThemesCustomizerPreviewPanel v-else-if="preview" :css="preview.css" :font-href="preview.fontHref" :color-mode="preview.colorMode" :device="device" />
      </div>
    </template>
  </UModal>
</template>
