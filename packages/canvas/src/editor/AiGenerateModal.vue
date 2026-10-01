<script setup lang="ts">
import { ref, onMounted, onUnmounted, resolveComponent } from 'vue'
import UIcon from '@nuxt/ui/components/Icon.vue'
import type { AiGenerateRequest, CanvasContent } from '../types'

const props = defineProps<{ hasBlocks: boolean; initial?: AiGenerateRequest | null }>()
const emit = defineEmits<{
  generate: [content: CanvasContent, request: AiGenerateRequest]
  close: []
}>()

// ── Dialog semantics: Escape-to-close, initial focus, and focus restore ─────
// Mirrors BlockPicker.vue's identical handling.
const modalRef = ref<HTMLElement | null>(null)
let previouslyFocused: HTMLElement | null = null

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => {
  previouslyFocused = document.activeElement as HTMLElement | null
  document.addEventListener('keydown', handleKeydown)
  modalRef.value?.focus()
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
  previouslyFocused?.focus()
})

const description = ref(props.initial?.description ?? '')
const tone = ref<AiGenerateRequest['tone']>(props.initial?.tone ?? 'professional')
const pageGoal = ref<AiGenerateRequest['pageGoal']>(props.initial?.pageGoal ?? 'landing')
const mode = ref<AiGenerateRequest['mode']>(props.initial?.mode ?? 'replace')
const loading = ref(false)
const error = ref('')

// Voice dictation lives in the host app (it needs the app's auth'd API and Nuxt UI), so
// it's resolved by name like EditorMediaPicker — absent outside the NuxFlow admin.
const resolvedVoice = resolveComponent('AiVoiceInput')
const voiceInput = typeof resolvedVoice === 'string' ? null : resolvedVoice

function appendDictation(text: string) {
  description.value = description.value ? `${description.value.trimEnd()} ${text}` : text
}

const toneOptions = [
  { label: 'Professional', value: 'professional' },
  { label: 'Casual', value: 'casual' },
  { label: 'Friendly', value: 'friendly' },
  { label: 'Bold', value: 'bold' },
  { label: 'Playful', value: 'playful' },
  { label: 'Technical', value: 'technical' },
]

const goalOptions = [
  { label: 'Landing page', value: 'landing' },
  { label: 'About page', value: 'about' },
  { label: 'Product page', value: 'product' },
  { label: 'Pricing page', value: 'pricing' },
  { label: 'Contact page', value: 'contact' },
  { label: 'Blog post', value: 'blog' },
  { label: 'General', value: 'general' },
]

async function generate() {
  if (description.value.trim().length < 10) {
    error.value = 'Please describe your page in at least 10 characters.'
    return
  }
  loading.value = true
  error.value = ''
  try {
    const res = await fetch('/api/v1/ai/generate-canvas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: description.value.trim(), tone: tone.value, pageGoal: pageGoal.value }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { message?: string }
      throw new Error(err.message || 'Generation failed')
    }
    const result = await res.json() as CanvasContent
    emit('generate', result, {
      description: description.value.trim(),
      tone: tone.value,
      pageGoal: pageGoal.value,
      mode: props.hasBlocks ? mode.value : 'replace',
    })
  }
  catch (e: unknown) {
    error.value = (e instanceof Error && e.message) || 'Generation failed. Check your AI provider settings.'
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" @click.self="emit('close')">
    <div
      ref="modalRef"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-generate-modal-title"
      tabindex="-1"
      class="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-2xl outline-none"
    >
      <!-- Header -->
      <div class="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-800">
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-sparkles" mode="svg" class="w-4 h-4 text-primary-500" />
          <h2 id="ai-generate-modal-title" class="text-base font-semibold text-gray-900 dark:text-white">Generate page with AI</h2>
        </div>
        <button aria-label="Close" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors" @click="emit('close')">
          <UIcon name="i-lucide-x" mode="svg" class="w-4 h-4" />
        </button>
      </div>

      <!-- Body -->
      <div class="px-5 py-4 space-y-4">
        <div>
          <div class="flex items-center justify-between mb-1">
            <label for="ai-generate-description" class="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Describe your page <span class="text-red-500">*</span>
            </label>
            <component :is="voiceInput" v-if="voiceInput" @transcribed="appendDictation" />
          </div>
          <textarea
            id="ai-generate-description"
            v-model="description"
            rows="6"
            maxlength="2000"
            placeholder="e.g. A landing page for a SaaS project management tool targeting small teams. Highlight real-time collaboration, easy setup, and affordable pricing."
            class="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 px-3 py-2 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-y"
          />
          <p class="text-xs text-gray-400 text-right">{{ description.length }}/2000</p>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Page goal</label>
            <select
              v-model="pageGoal"
              class="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option v-for="o in goalOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tone</label>
            <select
              v-model="tone"
              class="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option v-for="o in toneOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
          </div>
        </div>

        <fieldset v-if="hasBlocks" class="space-y-1.5">
          <legend class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">This page already has blocks</legend>
          <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input v-model="mode" type="radio" value="replace" class="text-primary-600 focus:ring-primary-500">
            Replace them with the generated page
          </label>
          <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input v-model="mode" type="radio" value="append" class="text-primary-600 focus:ring-primary-500">
            Add the generated sections after them
          </label>
        </fieldset>

        <p class="text-xs text-gray-500 dark:text-gray-400 flex items-start gap-1.5">
          <UIcon name="i-lucide-eye" mode="svg" class="w-3.5 h-3.5 mt-0.5 shrink-0" />
          The result opens as a preview on the canvas — keep it, regenerate it, or discard it to get the page back exactly as it was.
        </p>

        <p v-if="error" class="text-sm text-red-500 flex items-center gap-1.5">
          <UIcon name="i-lucide-alert-circle" mode="svg" class="w-4 h-4" />
          {{ error }}
        </p>
      </div>

      <!-- Footer -->
      <div class="flex justify-end gap-2 px-5 py-4 border-t border-gray-200 dark:border-gray-800">
        <button
          class="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
          @click="emit('close')"
        >
          Cancel
        </button>
        <button
          :disabled="loading || description.trim().length < 10"
          class="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-white text-sm font-medium bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          @click="generate"
        >
          <UIcon v-if="loading" name="i-lucide-loader-2" mode="svg" class="w-4 h-4 animate-spin" />
          <UIcon v-else name="i-lucide-sparkles" mode="svg" class="w-4 h-4" />
          {{ loading ? 'Generating…' : initial ? 'Regenerate' : 'Generate page' }}
        </button>
      </div>
    </div>
  </div>
</template>
