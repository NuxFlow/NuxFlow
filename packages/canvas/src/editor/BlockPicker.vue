<script setup lang="ts">
import { inject, computed, ref, onMounted, onUnmounted } from 'vue'
import UIcon from '@nuxt/ui/components/Icon.vue'
import { CANVAS_BLOCKS, getDynamicBlockDefinitions } from '../blocks/definitions'
import type { CanvasBlockRegistry } from '../types'

const emit = defineEmits<{ pick: [typeId: string]; close: [] }>()

// ── Dialog semantics: Escape-to-close, initial focus, and focus restore ─────
// The picker is mounted/unmounted via the host's `v-if="showPicker"` (see
// CanvasContentEditor.vue), so capturing the triggering element on mount and
// restoring it on unmount is sufficient.

const searchRef = ref<HTMLInputElement | null>(null)
let previouslyFocused: HTMLElement | null = null

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => {
  previouslyFocused = document.activeElement as HTMLElement | null
  document.addEventListener('keydown', handleKeydown)
  searchRef.value?.focus()
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
  previouslyFocused?.focus()
})

// ── The blocks on offer ─────────────────────────────────────────────────────

interface PickerBlock {
  id: string
  name: string
  description?: string
  icon?: string
  category: string
}

const CATEGORY_LABELS: Record<string, string> = {
  content: 'Content',
  media: 'Media',
  layout: 'Layout',
  cta: 'Call to action',
  forms: 'Forms',
  commerce: 'Selling & booking',
  advanced: 'Advanced',
  extensions: 'Extensions',
}
const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS)

const registry = inject<Pick<CanvasBlockRegistry, 'all' | 'dynamicBlocks'> | null>('nuxflow:blockRegistry', null)

const allBlocks = computed<PickerBlock[]>(() => {
  const builtIn = CANVAS_BLOCKS.map(b => ({ id: b.id, name: b.name, description: b.description, icon: b.icon, category: b.category as string }))
  // Blocks from installed dynamic plugins: full definitions first, then registry-only entries.
  const dynamicDefs = getDynamicBlockDefinitions()
  const defIds = new Set(dynamicDefs.map(b => b.id))
  const extensions = [
    ...dynamicDefs,
    ...(registry?.dynamicBlocks() ?? []).filter(b => !defIds.has(b.id)),
  ].map(b => ({ id: b.id, name: b.name, description: b.description, icon: b.icon, category: 'extensions' }))
  return [...builtIn, ...extensions]
})

const categories = computed(() =>
  CATEGORY_ORDER
    .map(id => ({ id, label: CATEGORY_LABELS[id]!, count: allBlocks.value.filter(b => b.category === id).length }))
    .filter(c => c.count > 0),
)

// ── Search and category filter ──────────────────────────────────────────────

const query = ref('')
const activeCategory = ref<string | null>(null)

function matches(b: PickerBlock, words: string[]): boolean {
  const haystack = `${b.name} ${b.description ?? ''} ${CATEGORY_LABELS[b.category] ?? ''}`.toLowerCase()
  return words.every(w => haystack.includes(w))
}

const filtered = computed(() => {
  const words = query.value.toLowerCase().split(/\s+/).filter(Boolean)
  return allBlocks.value.filter(b =>
    (!activeCategory.value || b.category === activeCategory.value)
    && (!words.length || matches(b, words)),
  )
})

// Grouped by category, unless a search is narrowing things down — then name
// matches come first in one flat list, since the grouping no longer helps.
const sections = computed(() => {
  if (query.value.trim()) {
    const q = query.value.trim().toLowerCase()
    const sorted = [...filtered.value].sort((a, b) =>
      Number(!a.name.toLowerCase().includes(q)) - Number(!b.name.toLowerCase().includes(q)),
    )
    return sorted.length ? [{ id: 'results', label: '', blocks: sorted }] : []
  }
  return categories.value
    .map(c => ({ id: c.id, label: activeCategory.value ? '' : c.label, blocks: filtered.value.filter(b => b.category === c.id) }))
    .filter(s => s.blocks.length)
})

/** Enter in the search box adds the first match. */
function pickFirst() {
  const first = sections.value[0]?.blocks[0]
  if (first) emit('pick', first.id)
}
</script>

<template>
  <div class="fixed inset-0 z-50 overflow-y-auto bg-black/50" @click.self="emit('close')">
    <div class="flex min-h-full items-center justify-center p-4" @click.self="emit('close')">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="block-picker-title"
        class="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-3xl h-[85vh] max-h-[48rem] flex flex-col overflow-hidden outline-none"
      >
        <!-- Header -->
        <div class="flex items-center justify-between px-5 pt-4 pb-3">
          <h2 id="block-picker-title" class="text-base font-semibold text-gray-900 dark:text-white">Add a block</h2>
          <button
            class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            aria-label="Close"
            @click="emit('close')"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <!-- Search + categories -->
        <div class="px-5 pb-3 space-y-3 border-b border-gray-200 dark:border-gray-800">
          <div class="relative">
            <UIcon name="i-lucide-search" mode="svg" class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              ref="searchRef"
              v-model="query"
              type="search"
              placeholder="Search blocks — e.g. gallery, form, map"
              aria-label="Search blocks"
              class="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 pl-9 pr-3 py-2 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              @keydown.enter.prevent="pickFirst"
            >
          </div>
          <div class="flex gap-1.5 overflow-x-auto -mx-5 px-5 pb-0.5" role="group" aria-label="Block categories">
            <button
              type="button"
              class="shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors"
              :class="activeCategory === null
                ? 'bg-primary-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'"
              :aria-pressed="activeCategory === null"
              @click="activeCategory = null"
            >
              All
            </button>
            <button
              v-for="c in categories"
              :key="c.id"
              type="button"
              class="shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors"
              :class="activeCategory === c.id
                ? 'bg-primary-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'"
              :aria-pressed="activeCategory === c.id"
              @click="activeCategory = activeCategory === c.id ? null : c.id"
            >
              {{ c.label }} <span class="opacity-60">{{ c.count }}</span>
            </button>
          </div>
        </div>

        <!-- Block list -->
        <div class="overflow-y-auto flex-1 min-h-0 px-5 py-4 space-y-6">
          <div v-for="section in sections" :key="section.id">
            <p v-if="section.label" class="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
              {{ section.label }}
            </p>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                v-for="block in section.blocks"
                :key="block.id"
                type="button"
                :data-block-type="block.id"
                class="flex items-start gap-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 text-left hover:border-primary-400 hover:bg-primary-50/50 dark:hover:border-primary-600 dark:hover:bg-primary-950/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 transition-colors group"
                @click="emit('pick', block.id)"
              >
                <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-gray-100 text-gray-600 group-hover:bg-primary-100 group-hover:text-primary-700 dark:bg-gray-800 dark:text-gray-300 dark:group-hover:bg-primary-900/60 dark:group-hover:text-primary-300 transition-colors">
                  <UIcon :name="block.icon ?? 'i-lucide-box'" mode="svg" class="w-5 h-5" />
                </span>
                <span class="min-w-0">
                  <span class="block text-sm font-medium text-gray-900 dark:text-white leading-tight">{{ block.name }}</span>
                  <span v-if="block.description" class="mt-0.5 block text-xs text-gray-500 dark:text-gray-400 leading-snug line-clamp-2">
                    {{ block.description }}
                  </span>
                </span>
              </button>
            </div>
          </div>

          <div v-if="!sections.length" class="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <UIcon name="i-lucide-search-x" mode="svg" class="w-8 h-8 text-gray-300 dark:text-gray-600" />
            <p class="text-sm text-gray-500 dark:text-gray-400">No blocks match “{{ query }}”.</p>
            <button
              type="button"
              class="text-sm font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400"
              @click="query = ''; activeCategory = null"
            >
              Show all blocks
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
