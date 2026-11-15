<script setup lang="ts">
import {
  CUSTOMIZER_DEFAULTS,
  type CustomizerState,
  type CustomizerValues,
  appearanceCss,
  customizerCss,
  parseCustomizerValues,
  siteFontsHref,
} from '#shared/lib/theme-customizer'

definePageMeta({ layout: false, middleware: ['auth'] })

// ── State ─────────────────────────────────────────────────────────────────────

const values = reactive<CustomizerValues>({ ...CUSTOMIZER_DEFAULTS })
const savedValues = ref<CustomizerValues>({ ...CUSTOMIZER_DEFAULTS })
const customizerThemeId = ref<string | null>(null)
const live = ref(false)
const activeThemeName = ref<string | null>(null)
const device = ref<'desktop' | 'tablet' | 'mobile'>('desktop')
const { run, isRunning } = useAdminAction()
const saving = computed(() => isRunning('save'))

// ── Load saved customizer state ───────────────────────────────────────────────

const { data: customizerData, error: loadError } = await useFetch<CustomizerState>('/api/v1/themes/customizer')

// useFetch is awaited at top-level so data is guaranteed available here.
// We deliberately do NOT use watchEffect — Nuxt background re-validation would
// fire it again after the user has started editing, wiping their unsaved changes.
if (customizerData.value) {
  Object.assign(values, customizerData.value.values)
  savedValues.value = { ...customizerData.value.values }
  customizerThemeId.value = customizerData.value.customizerThemeId
  live.value = customizerData.value.live
  activeThemeName.value = customizerData.value.activeThemeName
}

// ── Live preview ──────────────────────────────────────────────────────────────
// The same two functions the server uses when publishing (shared/lib/theme-customizer.ts):
// appearanceCss() is what the site writes into every page from the shared appearance
// settings, customizerCss() is the customizer's own theme CSS.

// Spread (not toRaw) so the computed tracks every field.
const checkedValues = computed(() => parseCustomizerValues({ ...values }))
const preview = computed(() => ({
  css: `${appearanceCss(checkedValues.value)}\n${customizerCss(checkedValues.value)}`,
  fontHref: siteFontsHref([checkedValues.value.bodyFont, checkedValues.value.headingFont]),
  colorMode: checkedValues.value.colorMode,
}))

// ── Changes detection ─────────────────────────────────────────────────────────

const hasChanges = computed(() => JSON.stringify(values) !== JSON.stringify(savedValues.value))

// ── Save ──────────────────────────────────────────────────────────────────────

async function save() {
  if (loadError.value) return
  await run(async () => {
    const result = await $fetch<{ themeId: string; values: CustomizerValues }>('/api/v1/themes/customizer', {
      method: 'POST',
      body: { values: toRaw(values) },
    })
    customizerThemeId.value = result.themeId
    live.value = true
    activeThemeName.value = null
    // The server's checked copy: anything it corrected shows here as it was published.
    Object.assign(values, result.values)
    savedValues.value = { ...result.values }
  }, { successTitle: 'Changes published', errorTitle: "Couldn't publish changes", key: 'save' })
}
</script>

<template>
  <div class="h-screen flex flex-col bg-white dark:bg-gray-950 overflow-hidden">
    <AdminThemesCustomizerTopBar
      v-model:device="device"
      :has-changes="hasChanges"
      :saving="saving"
      :customizer-theme-id="customizerThemeId"
      :load-failed="!!loadError"
      :on-save="save"
    />

    <UAlert v-if="loadError" color="error" variant="soft" icon="i-lucide-circle-alert" class="rounded-none" :description="getErrorMessage(loadError, 'Could not load your saved customizer settings — reload the page before publishing, or these defaults will replace them')" />
    <UAlert
      v-else-if="customizerThemeId && !live"
      color="warning"
      variant="soft"
      icon="i-lucide-info"
      class="rounded-none"
      :description="activeThemeName
        ? `Your customizer changes aren't on the live site: “${activeThemeName}” is the active theme now. Publishing puts them back, on top of “${activeThemeName}”.`
        : `Your customizer changes aren't on the live site: another theme was switched on. Publishing puts them back.`"
    />

    <div class="flex flex-1 overflow-hidden">
      <AdminThemesCustomizerControlsPanel v-model:values="values" />
      <AdminThemesCustomizerPreviewPanel :css="preview.css" :font-href="preview.fontHref" :color-mode="preview.colorMode" :device="device" />
    </div>
  </div>
</template>
