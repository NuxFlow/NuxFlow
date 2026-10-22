<script setup lang="ts">
const props = defineProps<{ contentId: string }>()
const emit = defineEmits<{ restored: [] }>()

interface Revision {
  id: string
  title: string
  createdAt: string
}

const { data } = await useFetch<{ revisions?: Revision[] }>(() => `/api/v1/content/${props.contentId}/revisions`)
const revisions = computed(() => data.value?.revisions ?? [])
const { run, isRunning } = useAdminAction()

async function restore(revisionId: string) {
  await run(async () => {
    await $fetch<unknown>(`/api/v1/content/${props.contentId}/revisions/${revisionId}/restore`, { method: 'POST' })
    emit('restored')
  }, { errorTitle: "Couldn't restore revision", key: revisionId })
}
</script>

<template>
  <div class="space-y-2">
    <p class="text-xs font-semibold text-gray-400 uppercase tracking-wide">Revision history</p>

    <div v-if="revisions.length" class="space-y-1">
      <div
        v-for="rev in revisions"
        :key="rev.id"
        class="flex items-center justify-between p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 group"
      >
        <div class="min-w-0">
          <p class="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">{{ rev.title }}</p>
          <p class="text-xs text-gray-400">{{ formatLocalDateTime(rev.createdAt) }}</p>
        </div>
        <UButton
          size="xs"
          variant="ghost"
          class="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 transition-opacity shrink-0"
          :loading="isRunning(rev.id)"
          @click="restore(rev.id)"
        >
          Restore
        </UButton>
      </div>
    </div>
    <p v-else class="text-xs text-gray-400 py-2">No revisions yet</p>
  </div>
</template>
