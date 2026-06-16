<script setup lang="ts">
definePageMeta({ layout: false, middleware: ['auth'] })

// ── Types ─────────────────────────────────────────────────────────────────────

interface CustomizerValues {
  colorMode: 'auto' | 'light' | 'dark'
  primaryColor: string
  linkColor: string
  bgLight: string
  bgDark: string
  bodyFont: string
  headingFont: string
  fontSize: 'xs' | 'sm' | 'base' | 'lg' | 'xl'
  headingWeight: '300' | '400' | '500' | '600' | '700' | '800'
  lineHeight: 'tight' | 'normal' | 'relaxed'
  borderRadius: 'none' | 'sm' | 'md' | 'lg' | 'xl' | 'full'
  spacing: 'compact' | 'normal' | 'spacious'
  contentWidth: 'narrow' | 'default' | 'wide' | 'full'
}

// ── Font definitions ──────────────────────────────────────────────────────────

const FONT_DEFS: { value: string; stack: string; q: string | null }[] = [
  { value: 'system', stack: 'system-ui,-apple-system,BlinkMacSystemFont,sans-serif', q: null },
  { value: 'Inter', stack: "'Inter',system-ui,sans-serif", q: 'family=Inter:wght@300;400;500;600;700;800' },
  { value: 'Geist', stack: "'Geist',system-ui,sans-serif", q: 'family=Geist:wght@300;400;500;600;700;800' },
  { value: 'DM Sans', stack: "'DM Sans',system-ui,sans-serif", q: 'family=DM+Sans:ital,opsz,wght@0,9..40,300..800;1,9..40,300..800' },
  { value: 'Outfit', stack: "'Outfit',system-ui,sans-serif", q: 'family=Outfit:wght@300;400;500;600;700;800' },
  { value: 'Plus Jakarta Sans', stack: "'Plus Jakarta Sans',system-ui,sans-serif", q: 'family=Plus+Jakarta+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800' },
  { value: 'Nunito', stack: "'Nunito',system-ui,sans-serif", q: 'family=Nunito:ital,wght@0,300;0,400;0,600;0,700;0,800;1,400' },
  { value: 'Poppins', stack: "'Poppins',system-ui,sans-serif", q: 'family=Poppins:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800' },
  { value: 'Raleway', stack: "'Raleway',system-ui,sans-serif", q: 'family=Raleway:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800' },
  { value: 'Open Sans', stack: "'Open Sans',system-ui,sans-serif", q: 'family=Open+Sans:ital,wght@0,300;0,400;0,600;0,700;0,800;1,300' },
  { value: 'Work Sans', stack: "'Work Sans',system-ui,sans-serif", q: 'family=Work+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700' },
  { value: 'Lora', stack: "'Lora',Georgia,serif", q: 'family=Lora:ital,wght@0,400;0,600;0,700;1,400;1,600' },
  { value: 'Merriweather', stack: "'Merriweather',Georgia,serif", q: 'family=Merriweather:ital,wght@0,300;0,400;0,700;1,300;1,400' },
  { value: 'Playfair Display', stack: "'Playfair Display',Georgia,serif", q: 'family=Playfair+Display:ital,wght@0,400;0,600;0,700;0,800;1,400' },
  { value: 'EB Garamond', stack: "'EB Garamond',Georgia,serif", q: 'family=EB+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400' },
  { value: 'JetBrains Mono', stack: "'JetBrains Mono',monospace", q: 'family=JetBrains+Mono:ital,wght@0,300;0,400;0,500;0,700;1,400' },
  { value: 'Fira Code', stack: "'Fira Code',monospace", q: 'family=Fira+Code:wght@300;400;500;600;700' },
]

// ── CSS generation maps ───────────────────────────────────────────────────────

const RADIUS_MAP: Record<string, string> = {
  none: '0px', sm: '4px', md: '8px', lg: '12px', xl: '16px', full: '9999px',
}

const FONT_SIZE_MAP: Record<string, string> = {
  xs: '0.875rem', sm: '0.9375rem', base: '1rem', lg: '1.0625rem', xl: '1.125rem',
}

const LINE_HEIGHT_MAP: Record<string, string> = {
  tight: '1.4', normal: '1.6', relaxed: '1.75',
}

const SPACING_MAP: Record<string, string> = {
  compact: '0.75', normal: '1', spacious: '1.5',
}

const CONTENT_WIDTH_MAP: Record<string, string> = {
  narrow: '720px', default: '960px', wide: '1200px', full: '100%',
}

function getFontStack(name: string): string {
  const def = FONT_DEFS.find(f => f.value === name)
  return def ? def.stack : `'${name}',system-ui,sans-serif`
}

function generateCSS(v: CustomizerValues): string {
  const lines: string[] = []

  // Google Fonts @import — must be first in the stylesheet
  const fontsToLoad = new Set<string>()
  if (v.bodyFont && v.bodyFont !== 'system') fontsToLoad.add(v.bodyFont)
  const headingActual = (v.headingFont && v.headingFont !== 'same') ? v.headingFont : v.bodyFont
  if (headingActual && headingActual !== 'system' && headingActual !== v.bodyFont) fontsToLoad.add(headingActual)

  for (const name of fontsToLoad) {
    const def = FONT_DEFS.find(f => f.value === name)
    if (def?.q) lines.push(`@import url('https://fonts.googleapis.com/css2?${def.q}&display=swap');`)
  }
  if (fontsToLoad.size) lines.push('')

  const bodyStack = getFontStack(v.bodyFont)
  const headingStack = getFontStack(headingActual)
  const linkColor = v.linkColor || v.primaryColor

  lines.push('/* NuxFlow Visual Customizer */')
  lines.push(':root {')
  lines.push(`  --nuxflow-primary: ${v.primaryColor};`)
  lines.push(`  --nuxflow-link: ${linkColor};`)
  lines.push(`  --nuxflow-radius: ${RADIUS_MAP[v.borderRadius] ?? '8px'};`)
  lines.push(`  --nuxflow-font: ${bodyStack};`)
  lines.push(`  --nuxflow-heading-font: ${headingStack};`)
  lines.push(`  --nuxflow-font-size: ${FONT_SIZE_MAP[v.fontSize] ?? '1rem'};`)
  lines.push(`  --nuxflow-line-height: ${LINE_HEIGHT_MAP[v.lineHeight] ?? '1.6'};`)
  lines.push(`  --nuxflow-heading-weight: ${v.headingWeight};`)
  lines.push(`  --nuxflow-spacing-scale: ${SPACING_MAP[v.spacing] ?? '1'};`)
  lines.push(`  --nuxflow-content-width: ${CONTENT_WIDTH_MAP[v.contentWidth] ?? '960px'};`)
  lines.push('}')
  lines.push('')

  lines.push('body {')
  if (v.bodyFont !== 'system') lines.push('  font-family: var(--nuxflow-font);')
  lines.push('  font-size: var(--nuxflow-font-size);')
  lines.push('  line-height: var(--nuxflow-line-height);')
  if (v.bgLight) lines.push(`  background-color: ${v.bgLight};`)
  lines.push('}')
  lines.push('')

  if (v.bgDark) {
    lines.push(`.dark body { background-color: ${v.bgDark}; }`)
    lines.push('')
  }

  lines.push('h1, h2, h3, h4, h5, h6 {')
  lines.push('  font-weight: var(--nuxflow-heading-weight);')
  if (headingActual !== v.bodyFont && headingActual !== 'system') {
    lines.push('  font-family: var(--nuxflow-heading-font);')
  }
  lines.push('}')
  lines.push('')

  lines.push('.nux-content a { color: var(--nuxflow-link); }')
  lines.push('.dark .nux-content a { color: var(--nuxflow-link); }')
  lines.push('.nux-content blockquote { border-left-color: var(--nuxflow-primary); }')

  if (v.borderRadius !== 'none') {
    lines.push('')
    lines.push('.nux-content pre,')
    lines.push('.nux-content blockquote,')
    lines.push('.nux-content img,')
    lines.push('.canvas-image figure img {')
    lines.push('  border-radius: var(--nuxflow-radius);')
    lines.push('}')
  }

  // Spacing — applies to known canvas section and prose wrappers
  if (v.spacing !== 'normal') {
    lines.push('')
    lines.push('.canvas-section {')
    lines.push('  padding-block: calc(4rem * var(--nuxflow-spacing-scale));')
    lines.push('}')
    lines.push('.nux-section { padding-block: calc(3rem * var(--nuxflow-spacing-scale)); }')
  }

  // Content width — constrains the readable column inside sections
  if (v.contentWidth !== 'default') {
    lines.push('')
    lines.push('.canvas-section-inner,')
    lines.push('.nux-prose-container,')
    lines.push('.nux-content-container {')
    lines.push('  max-width: var(--nuxflow-content-width);')
    lines.push('  margin-inline: auto;')
    lines.push('}')
  }

  return lines.join('\n')
}

// ── Control option lists ──────────────────────────────────────────────────────

const colorModeOptions = [
  { value: 'auto' as const, label: 'Auto', icon: 'i-lucide-monitor' },
  { value: 'light' as const, label: 'Light', icon: 'i-lucide-sun' },
  { value: 'dark' as const, label: 'Dark', icon: 'i-lucide-moon' },
]

const colorSwatches = [
  '#00dc82', '#3b82f6', '#8b5cf6', '#f59e0b',
  '#ef4444', '#ec4899', '#06b6d4', '#14b8a6',
  '#f97316', '#84cc16', '#a855f7', '#64748b',
]

const bgLightSwatches = [
  '#ffffff', '#fafafa', '#f8fafc', '#f9fafb',
  '#fffbeb', '#fdf4ff', '#f0f9ff', '#f0fdf4',
]

const bgDarkSwatches = [
  '#030712', '#0a0a0a', '#0f172a', '#111827',
  '#09090b', '#020617', '#0c1445', '#0d1117',
]

const fontSizeOptions = [
  { value: 'xs' as const, label: 'XS' },
  { value: 'sm' as const, label: 'SM' },
  { value: 'base' as const, label: 'MD' },
  { value: 'lg' as const, label: 'LG' },
  { value: 'xl' as const, label: 'XL' },
]

const lineHeightOptions = [
  { value: 'tight' as const, label: 'Tight' },
  { value: 'normal' as const, label: 'Normal' },
  { value: 'relaxed' as const, label: 'Relaxed' },
]

const radiusOptions = [
  { value: 'none' as const, label: 'None', preview: '0px' },
  { value: 'sm' as const, label: 'Small', preview: '4px' },
  { value: 'md' as const, label: 'Medium', preview: '8px' },
  { value: 'lg' as const, label: 'Large', preview: '12px' },
  { value: 'xl' as const, label: 'XL', preview: '16px' },
  { value: 'full' as const, label: 'Pill', preview: '9999px' },
]

const spacingOptions = [
  { value: 'compact' as const, label: 'Compact' },
  { value: 'normal' as const, label: 'Normal' },
  { value: 'spacious' as const, label: 'Spacious' },
]

const contentWidthOptions = [
  { value: 'narrow' as const, label: 'Narrow', sub: '720px' },
  { value: 'default' as const, label: 'Default', sub: '960px' },
  { value: 'wide' as const, label: 'Wide', sub: '1200px' },
  { value: 'full' as const, label: 'Full', sub: '100%' },
]

const deviceOptions = [
  { value: 'desktop' as const, label: 'Desktop', icon: 'i-lucide-monitor' },
  { value: 'tablet' as const, label: 'Tablet', icon: 'i-lucide-tablet' },
  { value: 'mobile' as const, label: 'Mobile', icon: 'i-lucide-smartphone' },
]

// ── Default values ────────────────────────────────────────────────────────────

const DEFAULTS: CustomizerValues = {
  colorMode: 'auto',
  primaryColor: '#00dc82',
  linkColor: '',
  bgLight: '',
  bgDark: '',
  bodyFont: 'system',
  headingFont: 'same',
  fontSize: 'base',
  headingWeight: '700',
  lineHeight: 'normal',
  borderRadius: 'md',
  spacing: 'normal',
  contentWidth: 'default',
}

// ── State ─────────────────────────────────────────────────────────────────────

const values = reactive<CustomizerValues>({ ...DEFAULTS })
const savedValues = ref<CustomizerValues>({ ...DEFAULTS })
const customizerThemeId = ref<string | null>(null)
const previewPath = ref('/')
const device = ref<'desktop' | 'tablet' | 'mobile'>('desktop')
const iframeEl = ref<HTMLIFrameElement | null>(null)
const saving = ref(false)
const toast = useToast()

// ── Load saved customizer state ───────────────────────────────────────────────

const { data: customizerData } = await useFetch<{ values: CustomizerValues; customizerThemeId: string | null }>(
  '/api/v1/themes/customizer',
)

// useFetch is awaited at top-level so data is guaranteed available here.
// We deliberately do NOT use watchEffect — Nuxt background re-validation would
// fire it again after the user has started editing, wiping their unsaved changes.
if (customizerData.value) {
  Object.assign(values, customizerData.value.values)
  savedValues.value = { ...customizerData.value.values }
  customizerThemeId.value = customizerData.value.customizerThemeId
}

// ── Live preview ──────────────────────────────────────────────────────────────

const currentCSS = computed(() => generateCSS(values))

function sendPreviewCSS() {
  iframeEl.value?.contentWindow?.postMessage(
    { type: 'nuxflow:preview-css', css: currentCSS.value },
    window.location.origin,
  )
}

let previewTimer: ReturnType<typeof setTimeout> | null = null
watch(currentCSS, () => {
  if (previewTimer) clearTimeout(previewTimer)
  previewTimer = setTimeout(sendPreviewCSS, 300)
})

function onIframeLoad() {
  // Re-inject CSS after every iframe navigation (plugin re-initialises on each load)
  setTimeout(sendPreviewCSS, 100)
}

function navigatePreview() {
  if (!iframeEl.value) return
  const path = previewPath.value.startsWith('/') ? previewPath.value : '/' + previewPath.value
  iframeEl.value.src = path
}

// ── Device frame ──────────────────────────────────────────────────────────────

const iframeWrapperStyle = computed(() => {
  if (device.value === 'mobile') return { width: '375px', minWidth: '375px', maxWidth: '375px', height: '100%' }
  if (device.value === 'tablet') return { width: '768px', minWidth: '768px', maxWidth: '768px', height: '100%' }
  return { width: '100%', height: '100%' }
})

// ── Changes detection ─────────────────────────────────────────────────────────

const hasChanges = computed(() => JSON.stringify(values) !== JSON.stringify(savedValues.value))

// ── Save ──────────────────────────────────────────────────────────────────────

async function save() {
  saving.value = true
  try {
    const result = await $fetch<{ themeId: string }>('/api/v1/themes/customizer', {
      method: 'POST',
      body: { values: toRaw(values), css: currentCSS.value },
    })
    customizerThemeId.value = result.themeId
    savedValues.value = { ...toRaw(values) }
    toast.add({ title: 'Changes published!', icon: 'i-lucide-check-circle', color: 'green' })
  } catch (e) {
    const msg = (e as { data?: { message?: string } })?.data?.message ?? 'Failed to publish'
    toast.add({ title: msg, color: 'red' })
  } finally {
    saving.value = false
  }
}

// Shared select class (avoids long repetition in template)
const SELECT_CLS = 'w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500'
const BTN_ACTIVE = 'bg-primary-500 text-white shadow-sm'
const BTN_INACTIVE = 'bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700'
</script>

<template>
  <div class="h-screen flex flex-col bg-white dark:bg-gray-950 overflow-hidden">

    <!-- ── Top bar ──────────────────────────────────────────────────────────── -->
    <header class="h-14 shrink-0 border-b border-gray-200 dark:border-gray-800 flex items-center gap-3 px-4 bg-white dark:bg-gray-950">
      <!-- Back link -->
      <NuxtLink
        to="/admin/themes"
        class="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors shrink-0"
      >
        <UIcon name="i-lucide-arrow-left" class="w-4 h-4" />
        <span class="hidden sm:inline">Themes</span>
      </NuxtLink>

      <!-- Title -->
      <div class="flex-1 flex items-center justify-center gap-2 min-w-0">
        <UIcon name="i-lucide-palette" class="w-4 h-4 text-gray-400 shrink-0" />
        <span class="text-sm font-semibold text-gray-700 dark:text-gray-200 truncate">Visual Customizer</span>
        <Transition
          enter-active-class="transition-all duration-200"
          enter-from-class="opacity-0 scale-90"
          leave-active-class="transition-all duration-200"
          leave-to-class="opacity-0 scale-90"
        >
          <span v-if="hasChanges" class="text-xs font-medium text-amber-500 dark:text-amber-400 shrink-0">
            • Unsaved
          </span>
        </Transition>
      </div>

      <!-- Device toggles + Publish -->
      <div class="flex items-center gap-2 shrink-0">
        <div class="hidden sm:flex gap-0.5 bg-gray-100 dark:bg-gray-800 p-0.5 rounded-lg">
          <button
            v-for="d in deviceOptions"
            :key="d.value"
            :title="d.label"
            class="p-1.5 rounded-md transition-colors"
            :class="device === d.value
              ? 'bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-white'
              : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'"
            @click="device = d.value"
          >
            <UIcon :name="d.icon" class="w-4 h-4" />
          </button>
        </div>

        <UButton
          size="sm"
          icon="i-lucide-upload-cloud"
          :loading="saving"
          :disabled="!hasChanges && !!customizerThemeId"
          @click="save"
        >
          Publish
        </UButton>
      </div>
    </header>

    <!-- ── Main two-panel layout ─────────────────────────────────────────────── -->
    <div class="flex flex-1 overflow-hidden">

      <!-- ── LEFT: Controls panel ────────────────────────────────────────────── -->
      <aside class="w-72 shrink-0 border-r border-gray-200 dark:border-gray-800 overflow-y-auto bg-gray-50/80 dark:bg-gray-900/50">

        <!-- Appearance (color mode) -->
        <section class="border-b border-gray-200 dark:border-gray-800 p-4 space-y-3">
          <p class="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest">Appearance</p>
          <div class="flex gap-0.5 p-0.5 bg-gray-100 dark:bg-gray-800 rounded-xl">
            <button
              v-for="m in colorModeOptions"
              :key="m.value"
              class="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-[10px] text-xs font-medium transition-colors"
              :class="values.colorMode === m.value
                ? 'bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-white'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'"
              @click="values.colorMode = m.value"
            >
              <UIcon :name="m.icon" class="w-3.5 h-3.5" />
              {{ m.label }}
            </button>
          </div>
        </section>

        <!-- Colors -->
        <section class="border-b border-gray-200 dark:border-gray-800 p-4 space-y-5">
          <p class="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest">Colors</p>

          <!-- Accent color -->
          <div class="space-y-2">
            <label class="text-xs font-medium text-gray-600 dark:text-gray-300">Accent color</label>
            <div class="flex items-center gap-2">
              <input
                v-model="values.primaryColor"
                type="color"
                class="w-9 h-9 rounded-lg cursor-pointer border border-gray-200 dark:border-gray-700 bg-transparent p-0.5 shrink-0"
              >
              <input
                v-model="values.primaryColor"
                type="text"
                placeholder="#00dc82"
                class="flex-1 px-2.5 py-1.5 text-xs font-mono rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
            </div>
            <!-- Quick swatches -->
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="sw in colorSwatches"
                :key="sw"
                :title="sw"
                class="w-5 h-5 rounded-md border-2 transition-transform hover:scale-110 focus:outline-none"
                :style="{ backgroundColor: sw, borderColor: values.primaryColor === sw ? '#000' : 'transparent' }"
                @click="values.primaryColor = sw"
              />
            </div>
          </div>

          <!-- Link color -->
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <label class="text-xs font-medium text-gray-600 dark:text-gray-300">Link color</label>
              <button
                v-if="values.linkColor"
                class="text-[10px] text-primary-500 hover:text-primary-600 dark:hover:text-primary-400"
                @click="values.linkColor = ''"
              >
                Reset to accent
              </button>
              <span v-else class="text-[10px] text-gray-400 dark:text-gray-500">Using accent</span>
            </div>
            <div class="flex items-center gap-2">
              <input
                type="color"
                :value="values.linkColor || values.primaryColor"
                class="w-9 h-9 rounded-lg cursor-pointer border border-gray-200 dark:border-gray-700 bg-transparent p-0.5 shrink-0"
                @input="(e) => values.linkColor = (e.target as HTMLInputElement).value"
              >
              <input
                type="text"
                :value="values.linkColor || values.primaryColor"
                placeholder="Same as accent"
                class="flex-1 px-2.5 py-1.5 text-xs font-mono rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                @input="(e) => values.linkColor = (e.target as HTMLInputElement).value"
              >
            </div>
          </div>
        </section>

        <!-- Background -->
        <section class="border-b border-gray-200 dark:border-gray-800 p-4 space-y-5">
          <p class="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest">Background</p>

          <!-- Light mode background -->
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <label class="text-xs font-medium text-gray-600 dark:text-gray-300">
                <UIcon name="i-lucide-sun" class="w-3 h-3 inline-block mr-1 opacity-60" />
                Light background
              </label>
              <button
                v-if="values.bgLight"
                class="text-[10px] text-primary-500 hover:text-primary-600 dark:hover:text-primary-400"
                @click="values.bgLight = ''"
              >
                Reset to theme
              </button>
              <span v-else class="text-[10px] text-gray-400 dark:text-gray-500">Using theme default</span>
            </div>
            <div class="flex items-center gap-2">
              <input
                type="color"
                :value="values.bgLight || '#ffffff'"
                class="w-9 h-9 rounded-lg cursor-pointer border border-gray-200 dark:border-gray-700 bg-transparent p-0.5 shrink-0"
                @input="(e) => values.bgLight = (e.target as HTMLInputElement).value"
              >
              <input
                type="text"
                :value="values.bgLight"
                placeholder="e.g. #ffffff"
                class="flex-1 px-2.5 py-1.5 text-xs font-mono rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                @input="(e) => values.bgLight = (e.target as HTMLInputElement).value"
              >
            </div>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="sw in bgLightSwatches"
                :key="sw"
                :title="sw"
                class="w-5 h-5 rounded border-2 transition-transform hover:scale-110 focus:outline-none"
                :style="{ backgroundColor: sw, borderColor: values.bgLight === sw ? '#6366f1' : '#d1d5db' }"
                @click="values.bgLight = sw"
              />
            </div>
          </div>

          <!-- Dark mode background -->
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <label class="text-xs font-medium text-gray-600 dark:text-gray-300">
                <UIcon name="i-lucide-moon" class="w-3 h-3 inline-block mr-1 opacity-60" />
                Dark background
              </label>
              <button
                v-if="values.bgDark"
                class="text-[10px] text-primary-500 hover:text-primary-600 dark:hover:text-primary-400"
                @click="values.bgDark = ''"
              >
                Reset to theme
              </button>
              <span v-else class="text-[10px] text-gray-400 dark:text-gray-500">Using theme default</span>
            </div>
            <div class="flex items-center gap-2">
              <input
                type="color"
                :value="values.bgDark || '#030712'"
                class="w-9 h-9 rounded-lg cursor-pointer border border-gray-200 dark:border-gray-700 bg-transparent p-0.5 shrink-0"
                @input="(e) => values.bgDark = (e.target as HTMLInputElement).value"
              >
              <input
                type="text"
                :value="values.bgDark"
                placeholder="e.g. #030712"
                class="flex-1 px-2.5 py-1.5 text-xs font-mono rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                @input="(e) => values.bgDark = (e.target as HTMLInputElement).value"
              >
            </div>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="sw in bgDarkSwatches"
                :key="sw"
                :title="sw"
                class="w-5 h-5 rounded border-2 transition-transform hover:scale-110 focus:outline-none"
                :style="{ backgroundColor: sw, borderColor: values.bgDark === sw ? '#6366f1' : '#374151' }"
                @click="values.bgDark = sw"
              />
            </div>
          </div>
        </section>

        <!-- Typography -->
        <section class="border-b border-gray-200 dark:border-gray-800 p-4 space-y-4">
          <p class="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest">Typography</p>

          <!-- Body font -->
          <div class="space-y-1.5">
            <label class="text-xs font-medium text-gray-600 dark:text-gray-300">Body font</label>
            <select v-model="values.bodyFont" :class="SELECT_CLS">
              <option value="system">System default</option>
              <optgroup label="Sans-serif">
                <option value="Inter">Inter</option>
                <option value="Geist">Geist</option>
                <option value="DM Sans">DM Sans</option>
                <option value="Outfit">Outfit</option>
                <option value="Plus Jakarta Sans">Plus Jakarta Sans</option>
                <option value="Nunito">Nunito</option>
                <option value="Poppins">Poppins</option>
                <option value="Raleway">Raleway</option>
                <option value="Open Sans">Open Sans</option>
                <option value="Work Sans">Work Sans</option>
              </optgroup>
              <optgroup label="Serif">
                <option value="Lora">Lora</option>
                <option value="Merriweather">Merriweather</option>
                <option value="Playfair Display">Playfair Display</option>
                <option value="EB Garamond">EB Garamond</option>
              </optgroup>
              <optgroup label="Monospace">
                <option value="JetBrains Mono">JetBrains Mono</option>
                <option value="Fira Code">Fira Code</option>
              </optgroup>
            </select>
          </div>

          <!-- Heading font -->
          <div class="space-y-1.5">
            <label class="text-xs font-medium text-gray-600 dark:text-gray-300">Heading font</label>
            <select v-model="values.headingFont" :class="SELECT_CLS">
              <option value="same">Same as body</option>
              <option value="system">System default</option>
              <optgroup label="Sans-serif">
                <option value="Inter">Inter</option>
                <option value="Geist">Geist</option>
                <option value="DM Sans">DM Sans</option>
                <option value="Outfit">Outfit</option>
                <option value="Plus Jakarta Sans">Plus Jakarta Sans</option>
                <option value="Nunito">Nunito</option>
                <option value="Poppins">Poppins</option>
                <option value="Raleway">Raleway</option>
                <option value="Open Sans">Open Sans</option>
                <option value="Work Sans">Work Sans</option>
              </optgroup>
              <optgroup label="Serif">
                <option value="Lora">Lora</option>
                <option value="Merriweather">Merriweather</option>
                <option value="Playfair Display">Playfair Display</option>
                <option value="EB Garamond">EB Garamond</option>
              </optgroup>
              <optgroup label="Monospace">
                <option value="JetBrains Mono">JetBrains Mono</option>
                <option value="Fira Code">Fira Code</option>
              </optgroup>
            </select>
          </div>

          <!-- Font size -->
          <div class="space-y-1.5">
            <label class="text-xs font-medium text-gray-600 dark:text-gray-300">Body size</label>
            <div class="grid grid-cols-5 gap-1">
              <button
                v-for="s in fontSizeOptions"
                :key="s.value"
                class="py-1.5 rounded-md text-[11px] font-medium transition-colors"
                :class="values.fontSize === s.value ? BTN_ACTIVE : BTN_INACTIVE"
                @click="values.fontSize = s.value"
              >{{ s.label }}</button>
            </div>
          </div>

          <!-- Heading weight -->
          <div class="space-y-1.5">
            <label class="text-xs font-medium text-gray-600 dark:text-gray-300">Heading weight</label>
            <select v-model="values.headingWeight" :class="SELECT_CLS">
              <option value="300">Light</option>
              <option value="400">Regular</option>
              <option value="500">Medium</option>
              <option value="600">Semibold</option>
              <option value="700">Bold</option>
              <option value="800">Extra Bold</option>
            </select>
          </div>

          <!-- Line spacing -->
          <div class="space-y-1.5">
            <label class="text-xs font-medium text-gray-600 dark:text-gray-300">Line spacing</label>
            <div class="grid grid-cols-3 gap-1">
              <button
                v-for="l in lineHeightOptions"
                :key="l.value"
                class="py-1.5 rounded-md text-[11px] font-medium transition-colors"
                :class="values.lineHeight === l.value ? BTN_ACTIVE : BTN_INACTIVE"
                @click="values.lineHeight = l.value"
              >{{ l.label }}</button>
            </div>
          </div>
        </section>

        <!-- Shape -->
        <section class="border-b border-gray-200 dark:border-gray-800 p-4 space-y-3">
          <p class="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest">Shape</p>
          <div class="space-y-1.5">
            <label class="text-xs font-medium text-gray-600 dark:text-gray-300">Corner radius</label>
            <div class="grid grid-cols-3 gap-1.5">
              <button
                v-for="r in radiusOptions"
                :key="r.value"
                class="flex flex-col items-center gap-1.5 py-2.5 rounded-lg text-[10px] font-medium transition-colors"
                :class="values.borderRadius === r.value
                  ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 ring-1 ring-inset ring-primary-400'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'"
                @click="values.borderRadius = r.value"
              >
                <div
                  class="w-7 h-5 bg-current opacity-40"
                  :style="{ borderRadius: r.preview }"
                />
                {{ r.label }}
              </button>
            </div>
          </div>
        </section>

        <!-- Layout -->
        <section class="p-4 space-y-4">
          <p class="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest">Layout</p>

          <!-- Spacing density -->
          <div class="space-y-1.5">
            <label class="text-xs font-medium text-gray-600 dark:text-gray-300">Section spacing</label>
            <div class="grid grid-cols-3 gap-1">
              <button
                v-for="s in spacingOptions"
                :key="s.value"
                class="py-1.5 rounded-md text-[11px] font-medium transition-colors"
                :class="values.spacing === s.value ? BTN_ACTIVE : BTN_INACTIVE"
                @click="values.spacing = s.value"
              >{{ s.label }}</button>
            </div>
          </div>

          <!-- Content width -->
          <div class="space-y-1.5">
            <label class="text-xs font-medium text-gray-600 dark:text-gray-300">Content width</label>
            <div class="grid grid-cols-2 gap-1.5">
              <button
                v-for="w in contentWidthOptions"
                :key="w.value"
                class="flex flex-col items-center gap-0.5 py-2 rounded-md text-[11px] font-medium transition-colors"
                :class="values.contentWidth === w.value
                  ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 ring-1 ring-inset ring-primary-400'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'"
                @click="values.contentWidth = w.value"
              >
                {{ w.label }}
                <span class="text-[9px] opacity-60 font-mono">{{ w.sub }}</span>
              </button>
            </div>
          </div>
        </section>
      </aside>

      <!-- ── RIGHT: Live preview ──────────────────────────────────────────────── -->
      <main class="flex-1 flex flex-col overflow-hidden">

        <!-- URL bar -->
        <div class="h-10 shrink-0 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 flex items-center gap-2 px-3">
          <UIcon name="i-lucide-globe" class="w-3.5 h-3.5 text-gray-400 shrink-0" />
          <input
            v-model="previewPath"
            type="text"
            placeholder="/"
            class="flex-1 bg-transparent text-sm text-gray-700 dark:text-gray-300 placeholder-gray-400 focus:outline-none font-mono"
            @keydown.enter="navigatePreview"
          >
          <button
            class="text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors px-1.5 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
            @click="navigatePreview"
          >
            Go
          </button>
        </div>

        <!-- Preview area -->
        <div
          class="flex-1 overflow-auto flex"
          :class="device !== 'desktop'
            ? 'items-center justify-center p-6 bg-gray-200 dark:bg-gray-900'
            : 'bg-gray-100 dark:bg-gray-900/80'"
        >
          <div
            class="overflow-hidden transition-all duration-300 bg-white"
            :class="device !== 'desktop' ? 'rounded-2xl shadow-2xl' : 'w-full h-full'"
            :style="iframeWrapperStyle"
          >
            <ClientOnly>
              <iframe
                ref="iframeEl"
                src="/"
                class="w-full h-full border-0 block"
                title="Live preview"
                @load="onIframeLoad"
              />
              <template #fallback>
                <div class="w-full h-full flex items-center justify-center text-sm text-gray-400 bg-gray-50 dark:bg-gray-800">
                  <div class="text-center space-y-2">
                    <UIcon name="i-lucide-monitor" class="w-8 h-8 mx-auto opacity-30" />
                    <p>Loading preview…</p>
                  </div>
                </div>
              </template>
            </ClientOnly>
          </div>
        </div>
      </main>
    </div>
  </div>
</template>
