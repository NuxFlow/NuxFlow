<script setup lang="ts">
import { computed } from 'vue'
import { spacingToCss, type SpacingValue } from '@nuxflow/canvas'
import { DEFAULT_SIGNUP_SETTINGS, publicSignupSettings, type PublicSignupSettings } from '#shared/lib/signup-prompt'

// Signup box Canvas block (`mailing-list/signup`) — the inline, no-popup way to collect
// email addresses. Heading/description/button come from the block; consent wording,
// name field and thank-you texts from Admin → Mailing list, so they're set once per site.

const props = withDefaults(defineProps<{
  title?: string
  description?: string
  submitLabel?: string
  bgColor?: string
  textColor?: string
  padding?: SpacingValue
}>(), {
  title: '',
  description: '',
  submitLabel: '',
  bgColor: undefined,
  textColor: undefined,
  padding: undefined,
})

const { data: site } = useFetch<{ signup?: PublicSignupSettings; turnstileSiteKey?: string | null }>('/api/public/site', {
  key: 'nuxflow-public-site',
  headers: useRequestHeaders(['host']),
})

const settings = computed(() => site.value?.signup ?? publicSignupSettings(DEFAULT_SIGNUP_SETTINGS))

const containerStyle = computed(() => ({
  backgroundColor: props.bgColor || 'transparent',
  color: props.textColor || 'inherit',
  padding: spacingToCss(props.padding, '48px 24px'),
}))
</script>

<template>
  <section class="canvas-signup w-full" :style="containerStyle">
    <div class="max-w-lg mx-auto">
      <div v-if="title || description" class="text-center mb-6 space-y-2">
        <h2 v-if="title" class="text-3xl font-extrabold tracking-tight">{{ title }}</h2>
        <p v-if="description" class="text-base opacity-85 whitespace-pre-wrap">{{ description }}</p>
      </div>
      <SignupForm
        :settings="settings"
        source="block"
        :button-label="submitLabel"
        :turnstile-site-key="site?.turnstileSiteKey"
      />
    </div>
  </section>
</template>
