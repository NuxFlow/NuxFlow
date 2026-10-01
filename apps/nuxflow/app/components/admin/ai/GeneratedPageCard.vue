<script setup lang="ts">
import type { NuxBlockData } from '~/types/blocks'

// One generated page on the Generate with AI review screen: its status, an inline
// preview of the blocks (rendered with the same NuxBlocks renderer the public site uses —
// the admin has no theme CSS, so "Full preview" opens the themed draft preview link in a
// new tab), and the per-page actions. Emits; the page owns every API call.
export interface GeneratedPage {
  index: number
  title: string
  slug: string
  error?: string
  item?: { id: string; title: string; slug: string; status: string; content: { blocks?: NuxBlockData[] } | null }
  /** The plan entry had a draft that's since been deleted. */
  missing?: boolean
}

const props = defineProps<{ page: GeneratedPage; busy?: boolean }>()
const emit = defineEmits<{ regenerate: []; discard: []; preview: [] }>()

const showPreview = ref(false)
const blocks = computed(() => props.page.item?.content?.blocks ?? [])
const statusColor = computed(() => (props.page.item?.status === 'published' ? 'success' : 'neutral'))
</script>

<template>
  <div class="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
    <div class="flex flex-wrap items-center gap-3 p-3">
      <div class="flex-1 min-w-[10rem]">
        <p class="font-medium text-sm flex items-center gap-2">
          {{ page.item?.title ?? page.title }}
          <UBadge v-if="page.item" :color="statusColor" variant="subtle" size="sm">{{ page.item.status }}</UBadge>
          <UBadge v-else-if="page.error" color="error" variant="subtle" size="sm">failed</UBadge>
          <UBadge v-else-if="page.missing" color="warning" variant="subtle" size="sm">discarded</UBadge>
        </p>
        <p class="text-xs text-gray-400">/{{ page.item?.slug ?? page.slug }}</p>
        <p v-if="page.error" class="text-xs text-red-500 mt-1">{{ page.error }}</p>
      </div>
      <div class="flex flex-wrap items-center gap-1.5">
        <template v-if="page.item">
          <UButton size="xs" variant="ghost" :icon="showPreview ? 'i-lucide-eye-off' : 'i-lucide-eye'" @click="showPreview = !showPreview">
            {{ showPreview ? 'Hide' : 'Preview' }}
          </UButton>
          <UButton size="xs" variant="ghost" icon="i-lucide-external-link" :disabled="busy" @click="emit('preview')">Full preview</UButton>
          <UButton size="xs" variant="ghost" icon="i-lucide-pencil" :to="`/admin/content/${page.item.id}`">Edit</UButton>
        </template>
        <UButton
          v-if="page.item?.status !== 'published'"
          size="xs"
          variant="ghost"
          icon="i-lucide-refresh-cw"
          :loading="busy"
          @click="emit('regenerate')"
        >
          {{ page.item ? 'Regenerate' : 'Retry' }}
        </UButton>
        <UButton v-if="page.item?.status === 'draft'" size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" :disabled="busy" @click="emit('discard')">
          Discard
        </UButton>
      </div>
    </div>
    <div
      v-if="showPreview && blocks.length"
      class="border-t border-gray-200 dark:border-gray-800 max-h-[70vh] overflow-y-auto bg-white dark:bg-gray-950"
    >
      <!-- inert: links/buttons inside the preview must not navigate away from the review.
           On an inner wrapper so the container itself still scrolls. -->
      <div inert>
        <NuxBlocks :blocks="blocks" />
      </div>
    </div>
  </div>
</template>
