<script setup lang="ts">
import { computed, inject } from 'vue'
import type { SpacingValue } from '../types'
import { spacingToCss } from '../utils/spacing'
import { useCanvasHost } from '../host'
import { canvasApiKey } from '../editor/canvasApi'

// Theme hooks: .canvas-chat, .canvas-chat .nuxflow-chat-panel.
// The website chatbot in the page. The conversation is the app's (CanvasHost.chatPanel): it
// needs the site's chatbot settings, Turnstile and the chat route, and must not be in the
// cached page. Shows nothing on the live site while the chatbot is switched off.

const props = withDefaults(defineProps<{
  title?: string
  intro?: string
  chatHeading?: string
  bgColor?: string
  textColor?: string
  padding?: SpacingValue
}>(), {
  title: 'Ask us anything',
  intro: '',
  chatHeading: '',
  bgColor: '',
  textColor: '',
  padding: undefined,
})

const host = useCanvasHost()
const inEditor = inject(canvasApiKey, null) !== null

const containerStyle = computed(() => ({
  backgroundColor: props.bgColor || undefined,
  color: props.textColor || undefined,
  padding: spacingToCss(props.padding, '48px 24px'),
}))
</script>

<template>
  <section class="canvas-chat" :style="containerStyle">
    <div class="mx-auto max-w-2xl">
      <h2 v-if="title" class="mb-2 text-center text-3xl font-bold">{{ title }}</h2>
      <p v-if="intro" class="mb-6 text-center opacity-80 whitespace-pre-line">{{ intro }}</p>
      <div v-if="inEditor || !host.chatPanel" class="rounded-xl border border-dashed border-current/30 p-6 text-center text-sm opacity-80">
        <p class="font-semibold">Website chat</p>
        <p class="mt-2">The chatbot shows here on the published page once it's switched on in Admin → Chatbot. The bubble in the corner is hidden on this page.</p>
      </div>
      <component :is="host.chatPanel" v-else :heading="chatHeading" />
    </div>
  </section>
</template>
