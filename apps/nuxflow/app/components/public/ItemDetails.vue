<script setup lang="ts">
import type { FieldDetail } from '#shared/lib/custom-fields'

// An item's custom fields (Admin → Content types) on its public page: "Bedrooms 3",
// "Price £250,000", "Garden Yes". Theme hooks: .nux-item-details, .nux-item-detail.
defineProps<{ details: FieldDetail[] }>()
</script>

<template>
  <dl v-if="details.length" class="nux-item-details grid gap-x-6 gap-y-3 rounded-xl border border-gray-200 dark:border-gray-800 p-4 sm:grid-cols-2">
    <div v-for="d in details" :key="d.key" class="nux-item-detail" :data-key="d.key">
      <dt class="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{{ d.label }}</dt>
      <dd class="mt-0.5 text-gray-900 dark:text-gray-100 whitespace-pre-line break-words">
        <a v-if="d.href" :href="d.href" target="_blank" rel="noopener nofollow" class="text-primary-600 dark:text-primary-400 underline">{{ d.text }}</a>
        <template v-else>{{ d.text }}</template>
      </dd>
    </div>
  </dl>
</template>
