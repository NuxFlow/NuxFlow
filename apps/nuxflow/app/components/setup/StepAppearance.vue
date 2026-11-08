<script setup lang="ts">
import type { StarterSummary } from '#shared/lib/starters'

const templateModel = defineModel<string>({ default: 'landing' })
/** Whether the chosen starter comes from the catalog (installed after sign-in). */
const fromCatalog = defineModel<boolean>('fromCatalog', { default: false })

const props = defineProps<{ loading?: boolean; error?: string; mediaStorage?: 'r2' | 'none' }>()
defineEmits<{ next: []; back: [] }>()

const { data } = await useFetch<{ starters: StarterSummary[]; catalogError: string | null }>('/api/v1/setup/starters')
const starters = computed(() => data.value?.starters ?? [])
const storageReady = computed(() => props.mediaStorage === undefined ? undefined : props.mediaStorage === 'r2')
const chosen = computed(() => starters.value.find(s => s.id === templateModel.value) ?? null)

watch(chosen, (s) => { fromCatalog.value = s?.source === 'catalog' }, { immediate: true })
// A choice that's no longer offered (or needs storage that isn't there) falls back to the first built-in.
watch(starters, (list) => {
  if (list.length && !list.some(s => s.id === templateModel.value && !(storageReady.value === false && s.needsStorage))) {
    templateModel.value = list.find(s => s.source === 'builtin')?.id ?? list[0]!.id
  }
}, { immediate: true })
</script>

<template>
  <div class="space-y-6">
    <div>
      <h2 class="text-xl font-bold text-gray-900 dark:text-white">Choose a starter site</h2>
      <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
        Pick a ready-made site to start from. You can change everything later, or switch to another starter in Admin → Starter sites.
      </p>
    </div>

    <div class="max-h-[28rem] overflow-y-auto pr-1">
      <StarterPicker :starters="starters" :selected="templateModel" :storage-ready="storageReady" compact @select="templateModel = $event" />
    </div>

    <p v-if="data?.catalogError" class="text-xs text-gray-500 dark:text-gray-400">
      More starter sites couldn't be loaded right now. You can pick one later from Admin → Starter sites.
    </p>
    <UAlert
      v-if="chosen?.source === 'catalog'"
      color="info"
      variant="soft"
      icon="i-lucide-info"
      :description="`${chosen.name}'s pages${chosen.imageCount ? ' and images' : ''} are added once you're signed in — your dashboard will show a button to finish installing it.`"
    />

    <!-- A status line, not a form: nothing to fill in, just what will happen to uploads. -->
    <div v-if="mediaStorage" class="flex items-start gap-2 rounded-lg border border-gray-200 dark:border-gray-800 px-3 py-2 text-sm">
      <UIcon
        :name="mediaStorage === 'r2' ? 'i-lucide-circle-check' : 'i-lucide-info'"
        :class="mediaStorage === 'r2' ? 'text-green-500' : 'text-gray-400'"
        class="w-4 h-4 mt-0.5 shrink-0"
      />
      <p v-if="mediaStorage === 'r2'" class="text-gray-700 dark:text-gray-300">
        <strong>File storage:</strong> R2 bucket connected — your images and files will be stored there.
      </p>
      <p v-else class="text-gray-700 dark:text-gray-300">
        <strong>File storage:</strong> not connected yet, so images will be kept in the database for now. That's fine for trying things out —
        you can connect storage later in Settings → Media and move everything over in one click.
      </p>
    </div>

    <UAlert v-if="error" color="error" variant="soft" :description="error" />

    <div class="flex items-center justify-between pt-4 border-t border-gray-100 dark:border-gray-800">
      <UButton variant="ghost" @click="$emit('back')">
        <UIcon name="i-lucide-arrow-left" class="mr-1 w-4 h-4" />
        Back
      </UButton>
      <UButton :loading="loading" size="lg" class="px-6" @click="$emit('next')">
        Finish setup
        <UIcon name="i-lucide-rocket" class="ml-1 w-4 h-4" />
      </UButton>
    </div>
  </div>
</template>
