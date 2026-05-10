<script setup lang="ts">
import { computed } from 'vue'
import type { SpacingValue } from '../types'

const props = withDefaults(defineProps<{
  sectionLabel?: string
  sectionTitle?: string
  sectionDesc?: string
  numFeatures?: number
  feat1Icon?: string
  feat1Title?: string
  feat1Desc?: string
  feat2Icon?: string
  feat2Title?: string
  feat2Desc?: string
  feat3Icon?: string
  feat3Title?: string
  feat3Desc?: string
  feat4Icon?: string
  feat4Title?: string
  feat4Desc?: string
  iconColor?: string
  align?: 'left' | 'center'
  style?: 'plain' | 'card' | 'icon-top'
  gap?: number
  bgColor?: string
  padding?: SpacingValue
}>(), {
  numFeatures: 3,
  feat1Icon: 'i-lucide-zap',
  feat1Title: 'Fast & reliable',
  feat1Desc: 'Built for performance from the ground up.',
  feat2Icon: 'i-lucide-shield-check',
  feat2Title: 'Secure by default',
  feat2Desc: 'Enterprise-grade security you can trust.',
  feat3Icon: 'i-lucide-sparkles',
  feat3Title: 'Easy to use',
  feat3Desc: 'Intuitive interface your whole team will love.',
  feat4Icon: 'i-lucide-globe',
  feat4Title: 'Works everywhere',
  feat4Desc: 'Access from any device, any time.',
  iconColor: '#6366f1',
  align: 'center',
  style: 'plain',
  gap: 32,
})

interface Feature { icon: string; title: string; desc: string }

const features = computed((): Feature[] => {
  const all: Feature[] = [
    { icon: props.feat1Icon ?? '', title: props.feat1Title ?? '', desc: props.feat1Desc ?? '' },
    { icon: props.feat2Icon ?? '', title: props.feat2Title ?? '', desc: props.feat2Desc ?? '' },
    { icon: props.feat3Icon ?? '', title: props.feat3Title ?? '', desc: props.feat3Desc ?? '' },
    { icon: props.feat4Icon ?? '', title: props.feat4Title ?? '', desc: props.feat4Desc ?? '' },
  ]
  return all.slice(0, Math.max(1, Math.min(4, props.numFeatures ?? 3)))
})

const gridCols = computed(() => ({
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-3',
  4: 'grid-cols-2 sm:grid-cols-4',
}[features.value.length] ?? 'grid-cols-1 sm:grid-cols-3'))

const hasBg = computed(() => !!props.bgColor)

const containerStyle = computed(() => {
  const p = props.padding
  const padding = p ? `${p.top}${p.unit} ${p.right}${p.unit} ${p.bottom}${p.unit} ${p.left}${p.unit}` : '48px 24px'
  return hasBg.value ? { backgroundColor: props.bgColor, padding } : { padding }
})

// When bgColor is explicitly set, derive text/card colors from its luminance so
// they're always readable against that fixed background regardless of dark mode.
// When bgColor is not set the block inherits the page background and Tailwind's
// dark: classes handle text/card colors instead.
function hexLuminance(hex: string): number {
  const h = hex.replace('#', '')
  if (h.length < 6) return 255
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return 0.299 * r + 0.587 * g + 0.114 * b
}

const onDark = computed(() => hasBg.value && hexLuminance(props.bgColor!) < 128)
const titleStyle = computed(() => hasBg.value ? { color: onDark.value ? '#f9fafb' : '#111827' } : undefined)
const muteStyle  = computed(() => hasBg.value ? { color: onDark.value ? '#9ca3af' : '#6b7280' } : undefined)
const cardStyle  = computed(() => hasBg.value ? {
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: onDark.value ? 'rgba(255,255,255,0.1)' : '#e5e7eb',
  backgroundColor: onDark.value ? 'rgba(255,255,255,0.05)' : '#ffffff',
} : undefined)
</script>

<template>
  <section :style="containerStyle">
    <!-- Optional section header -->
    <div v-if="sectionLabel || sectionTitle || sectionDesc" class="mx-auto max-w-5xl text-center mb-12 space-y-3">
      <p v-if="sectionLabel" class="text-xs font-semibold uppercase tracking-widest" style="color: #00dc82;">{{ sectionLabel }}</p>
      <h2 v-if="sectionTitle" class="text-3xl font-bold" :class="!hasBg && 'text-gray-900 dark:text-white'" :style="titleStyle">{{ sectionTitle }}</h2>
      <p v-if="sectionDesc" class="max-w-xl mx-auto" :class="!hasBg && 'text-gray-500 dark:text-gray-400'" :style="muteStyle">{{ sectionDesc }}</p>
    </div>

    <div
      class="mx-auto max-w-5xl grid"
      :class="gridCols"
      :style="{ gap: `${gap ?? 32}px` }"
    >
      <div
        v-for="feat in features"
        :key="feat.title"
        class="flex"
        :class="{
          'flex-col': style === 'icon-top' || align === 'center',
          'flex-row gap-4': style !== 'icon-top' && align === 'left',
          'items-center': align === 'center',
          'text-center': align === 'center',
          'rounded-xl p-6': style === 'card',
          'border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900': style === 'card' && !hasBg,
          'p-0': style !== 'card',
        }"
        :style="style === 'card' ? cardStyle : undefined"
      >
        <!-- Icon -->
        <div
          class="flex items-center justify-center w-11 h-11 rounded-xl shrink-0"
          :class="align === 'center' ? 'mx-auto mb-4' : style === 'icon-top' ? 'mb-4' : ''"
          :style="{ backgroundColor: `${iconColor ?? '#6366f1'}18` }"
        >
          <span
            :class="`${feat.icon} w-5 h-5`"
            :style="{ color: iconColor ?? '#6366f1' }"
          />
        </div>

        <!-- Text -->
        <div>
          <h3 class="text-base font-semibold mb-1.5" :class="!hasBg && 'text-gray-900 dark:text-white'" :style="titleStyle">{{ feat.title }}</h3>
          <p class="text-sm leading-relaxed" :class="!hasBg && 'text-gray-500 dark:text-gray-400'" :style="muteStyle">{{ feat.desc }}</p>
        </div>
      </div>
    </div>
  </section>
</template>
