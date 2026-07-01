<script setup lang="ts">
import { ref, computed } from 'vue'
import type { CanvasContent } from '../types'

const props = defineProps<{ hasBlocks: boolean }>()
const emit = defineEmits<{
  generate: [content: CanvasContent]
  close: []
}>()

const description = ref('')
const tone = ref<'professional' | 'casual' | 'friendly' | 'bold'>('professional')
const pageGoal = ref<'landing' | 'about' | 'product' | 'pricing' | 'contact' | 'blog' | 'general'>('landing')
const loading = ref(false)
const error = ref('')

const toneOptions = [
  { label: 'Professional', value: 'professional' },
  { label: 'Casual', value: 'casual' },
  { label: 'Friendly', value: 'friendly' },
  { label: 'Bold', value: 'bold' },
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
  if (description.value.length < 10) {
    error.value = 'Please describe your page in at least 10 characters.'
    return
  }
  if (props.hasBlocks) {
    if (!window.confirm('This will replace all existing blocks. Continue?')) return
  }
  loading.value = true
  error.value = ''
  try {
    const res = await fetch('/api/v1/ai/generate-canvas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: description.value, tone: tone.value, pageGoal: pageGoal.value }),
    })
    if (!res.ok) {
      const err = await res.json() as { message?: string }
      throw { data: err }
    }
    const result = await res.json() as CanvasContent
    emit('generate', result)
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message
    error.value = msg || 'Generation failed. Check your AI provider settings.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" @click.self="emit('close')">
    <div class="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg">
      <!-- Header -->
      <div class="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-800">
        <div class="flex items-center gap-2">
          <span class="i-lucide-sparkles w-4 h-4 text-primary-500" />
          <h2 class="text-base font-semibold text-gray-900 dark:text-white">Generate page with AI</h2>
        </div>
        <button class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors" @click="emit('close')">
          <span class="i-lucide-x w-4 h-4" />
        </button>
      </div>

      <!-- Body -->
      <div class="px-5 py-4 space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Describe your page <span class="text-red-500">*</span>
          </label>
          <textarea
            v-model="description"
            rows="4"
            placeholder="e.g. A landing page for a SaaS project management tool targeting small teams. Highlight real-time collaboration, easy setup, and affordable pricing."
            class="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 px-3 py-2 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
          />
        </div>

        <div class="grid grid-cols-2 gap-3">
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

        <p v-if="error" class="text-sm text-red-500 flex items-center gap-1.5">
          <span class="i-lucide-alert-circle w-4 h-4" />
          {{ error }}
        </p>

        <p v-if="hasBlocks" class="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
          <span class="i-lucide-triangle-alert w-3.5 h-3.5" />
          Existing blocks will be replaced.
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
          :disabled="loading || description.length < 10"
          class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          @click="generate"
        >
          <span v-if="loading" class="i-lucide-loader-2 w-4 h-4 animate-spin" />
          <span v-else class="i-lucide-sparkles w-4 h-4" />
          {{ loading ? 'Generating…' : 'Generate page' }}
        </button>
      </div>
    </div>
  </div>
</template>
