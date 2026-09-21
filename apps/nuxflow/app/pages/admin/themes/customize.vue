<script setup lang="ts">
import type { CustomizerValues } from '~/types/theme-customizer'

definePageMeta({ layout: false, middleware: ['auth'] })

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
const device = ref<'desktop' | 'tablet' | 'mobile'>('desktop')
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
    toast.add({ title: 'Changes published!', icon: 'i-lucide-check-circle', color: 'success' })
  } catch (e) {
    const msg = getErrorMessage(e, 'Failed to publish')
    toast.add({ title: msg, color: 'error' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="h-screen flex flex-col bg-white dark:bg-gray-950 overflow-hidden">
    <AdminThemesCustomizerTopBar
      v-model:device="device"
      :has-changes="hasChanges"
      :saving="saving"
      :customizer-theme-id="customizerThemeId"
      :on-save="save"
    />

    <div class="flex flex-1 overflow-hidden">
      <AdminThemesCustomizerControlsPanel v-model:values="values" />
      <AdminThemesCustomizerPreviewPanel :css="currentCSS" :device="device" />
    </div>
  </div>
</template>
