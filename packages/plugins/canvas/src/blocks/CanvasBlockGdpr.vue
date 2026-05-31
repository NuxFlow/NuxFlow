<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import type { SpacingValue } from '../types'

const props = withDefaults(defineProps<{
  text?: string
  acceptLabel?: string
  declineLabel?: string
  policyLabel?: string
  policyUrl?: string
  bgColor?: string
  textColor?: string
  btnColor?: string
  padding?: SpacingValue
}>(), {
  text: 'We use cookies to improve your experience and analyze site traffic.',
  acceptLabel: 'Accept All',
  declineLabel: 'Decline Essential Only',
  policyLabel: 'Privacy Policy',
  policyUrl: '/privacy',
  bgColor: '#0f172a',
  textColor: '#ffffff',
  btnColor: '#00dc82',
})

const isVisible = ref(false)

onMounted(() => {
  const consent = localStorage.getItem('nuxflow-cookie-consent')
  if (!consent) {
    isVisible.value = true
  }
})

function accept() {
  localStorage.setItem('nuxflow-cookie-consent', 'accepted')
  isVisible.value = false
}

function decline() {
  localStorage.setItem('nuxflow-cookie-consent', 'declined')
  isVisible.value = false
}

const wrapperStyle = computed(() => {
  const p = props.padding
  return {
    backgroundColor: props.bgColor,
    color: props.textColor,
    padding: p ? `${p.top}${p.unit} ${p.right}${p.unit} ${p.bottom}${p.unit} ${p.left}${p.unit}` : '16px 24px',
  }
})
</script>

<template>
  <div v-if="isVisible" class="canvas-gdpr fixed bottom-0 left-0 right-0 z-50 shadow-2xl transition-transform duration-500 ease-out translate-y-0" :style="wrapperStyle">
    <div class="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
      <div class="text-sm flex-1 opacity-90 leading-relaxed text-center sm:text-left">
        {{ text }}
        <a v-if="policyLabel" :href="policyUrl" class="underline underline-offset-2 opacity-80 hover:opacity-100 transition-opacity ml-1 whitespace-nowrap">
          {{ policyLabel }}
        </a>
      </div>
      <div class="flex items-center gap-3 w-full sm:w-auto shrink-0 justify-center">
        <button
          v-if="declineLabel"
          @click="decline"
          class="px-4 py-2 text-xs font-semibold rounded-lg border border-white/20 hover:bg-white/10 transition-colors whitespace-nowrap"
          :style="{ color: textColor }"
        >
          {{ declineLabel }}
        </button>
        <button
          @click="accept"
          class="px-5 py-2 text-xs font-bold rounded-lg shadow-lg hover:scale-105 transition-transform whitespace-nowrap"
          :style="{ backgroundColor: btnColor, color: '#030712' }"
        >
          {{ acceptLabel }}
        </button>
      </div>
    </div>
  </div>
</template>
