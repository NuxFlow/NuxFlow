<script setup lang="ts">
import { computed } from 'vue'
import type { SpacingValue } from '../types'

const props = withDefaults(defineProps<{
  headline?: string
  subtext?: string
  btnLabel?: string
  btnUrl?: string
  bgColor?: string
  textColor?: string
  btnColor?: string
  padding?: SpacingValue
}>(), {
  headline: 'Ready to get started?',
  subtext: 'Join thousands of happy customers.',
  btnLabel: 'Sign up free',
  btnUrl: '/signup',
  bgColor: '#00dc82',
  textColor: '#0f172a',
  btnColor: '#0f172a',
})

const containerStyle = computed(() => {
  const p = props.padding
  return {
    backgroundColor: props.bgColor,
    color: props.textColor,
    padding: p
      ? `${p.top}${p.unit} ${p.right}${p.unit} ${p.bottom}${p.unit} ${p.left}${p.unit}`
      : '48px 24px',
  }
})
</script>

<template>
  <section :style="containerStyle">
    <div class="mx-auto max-w-2xl text-center">
      <h2 class="text-3xl font-bold mb-3">{{ headline }}</h2>
      <p v-if="subtext" class="text-base opacity-80 mb-6">{{ subtext }}</p>
      <a
        v-if="btnLabel"
        :href="btnUrl"
        class="inline-block px-6 py-3 rounded-lg font-semibold text-sm transition-opacity hover:opacity-90"
        :style="{ backgroundColor: btnColor, color: bgColor }"
      >
        {{ btnLabel }}
      </a>
    </div>
  </section>
</template>
