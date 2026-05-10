<script setup lang="ts">
import { computed } from 'vue'
import type { SpacingValue } from '../types'

const props = withDefaults(defineProps<{
  headline?: string
  subtext?: string
  ctaLabel?: string
  ctaUrl?: string
  cta2Label?: string
  cta2Url?: string
  align?: 'left' | 'center' | 'right'
  bgColor?: string
  bgGradient?: string
  textColor?: string
  ctaBgColor?: string
  logoIcon?: string
  showDecorations?: boolean
  padding?: SpacingValue
}>(), {
  headline: 'Welcome to our site',
  subtext: 'We help you build amazing things.',
  ctaLabel: 'Get started',
  ctaUrl: '/',
  align: 'center',
  bgColor: '#ffffff',
  textColor: '#111827',
})

const containerStyle = computed(() => {
  const p = props.padding
  const paddingVal = p
    ? `${p.top}${p.unit} ${p.right}${p.unit} ${p.bottom}${p.unit} ${p.left}${p.unit}`
    : '80px 24px'
  return {
    background: props.bgGradient ?? props.bgColor,
    color: props.textColor,
    padding: paddingVal,
  }
})

const primaryCtaBg = computed(() => props.ctaBgColor ?? props.textColor)
const primaryCtaColor = computed(() => props.bgGradient ? '#030712' : (props.bgColor ?? '#ffffff'))
</script>

<template>
  <section class="relative overflow-hidden" :style="containerStyle">
    <!-- Grid overlay -->
    <div
      v-if="showDecorations"
      class="absolute inset-0 pointer-events-none"
      style="background-image: linear-gradient(to right, #ffffff08 1px, transparent 1px), linear-gradient(to bottom, #ffffff08 1px, transparent 1px); background-size: 40px 40px;"
    />
    <!-- Glow -->
    <div
      v-if="showDecorations"
      class="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] rounded-full blur-3xl pointer-events-none"
      style="background: rgba(0, 220, 130, 0.18);"
    />

    <div
      class="relative mx-auto max-w-5xl px-6 space-y-8"
      :class="{
        'text-left': align === 'left',
        'text-center': align === 'center',
        'text-right': align === 'right',
      }"
    >
      <!-- Logo mark -->
      <div
        v-if="logoIcon"
        :class="align === 'center' ? 'inline-flex' : 'flex'"
        class="items-center justify-center w-16 h-16 rounded-2xl mb-2"
        style="background: #00dc82; box-shadow: 0 20px 25px -5px rgba(0, 220, 130, 0.3);"
      >
        <span :class="`${logoIcon} w-8 h-8 text-white`" />
      </div>

      <h1 class="text-5xl sm:text-6xl font-extrabold tracking-tight leading-tight">{{ headline }}</h1>
      <p v-if="subtext" class="text-lg sm:text-xl opacity-80 max-w-2xl leading-relaxed whitespace-pre-wrap" :class="align === 'center' ? 'mx-auto' : ''">{{ subtext }}</p>

      <!-- CTAs -->
      <div
        v-if="ctaLabel || cta2Label"
        class="flex flex-col sm:flex-row items-center gap-4"
        :class="align === 'center' ? 'justify-center' : align === 'right' ? 'justify-end' : 'justify-start'"
      >
        <a
          v-if="ctaLabel"
          :href="ctaUrl"
          class="inline-flex items-center px-7 py-3.5 rounded-xl font-semibold text-sm shadow-lg transition-opacity hover:opacity-90"
          :style="{ backgroundColor: primaryCtaBg, color: primaryCtaColor }"
        >
          {{ ctaLabel }}
        </a>
        <a
          v-if="cta2Label"
          :href="cta2Url"
          class="inline-flex items-center px-7 py-3.5 rounded-xl font-semibold text-sm border transition-colors hover:bg-white/10"
          style="border-color: rgba(255,255,255,0.2);"
        >
          {{ cta2Label }}
        </a>
      </div>
    </div>
  </section>
</template>
