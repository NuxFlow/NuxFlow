<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })

const route = useRoute()
const id = route.params.id as string

const { data } = await useFetch(`/api/v1/forms/${id}/submissions`)
const form = computed(() => data.value?.form)
const submissions = computed(() => data.value?.submissions ?? [])

function downloadCsv() {
  if (!submissions.value.length) return
  const fields = Object.keys(submissions.value[0]?.data ?? {})
  const header = ['ID', 'Submitted at', ...fields].join(',')
  const rows = submissions.value.map((s: { id: string; createdAt: string; data: Record<string, unknown> }) =>
    [s.id, s.createdAt, ...fields.map(f => JSON.stringify(s.data[f] ?? ''))].join(','),
  )
  const csv = [header, ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${form.value?.name ?? 'submissions'}.csv`
  a.click()
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <UButton :to="`/admin/forms/${id}/edit`" variant="ghost" icon="i-lucide-arrow-left" size="sm" />
        <h1 class="text-xl font-bold text-gray-900 dark:text-white">{{ form?.name }} — Submissions</h1>
        <UBadge variant="soft" size="sm">{{ submissions.length }}</UBadge>
      </div>
      <UButton variant="outline" icon="i-lucide-download" @click="downloadCsv">Export CSV</UButton>
    </div>

    <UCard v-if="submissions.length">
      <div class="divide-y divide-gray-100 dark:divide-gray-800">
        <div
          v-for="sub in submissions"
          :key="sub.id"
          class="py-3 flex items-start gap-4"
        >
          <div class="text-xs text-gray-400 w-36 shrink-0 pt-0.5">
            {{ new Date(sub.createdAt).toLocaleString() }}
          </div>
          <div class="flex-1 grid grid-cols-2 gap-x-6 gap-y-1">
            <template v-for="(val, key) in sub.data" :key="key">
              <span class="text-xs font-medium text-gray-500">{{ key }}</span>
              <span class="text-sm text-gray-800 dark:text-gray-200 truncate">{{ val }}</span>
            </template>
          </div>
        </div>
      </div>
    </UCard>

    <div v-else class="text-center py-16 text-gray-400">
      <UIcon name="i-lucide-inbox" class="w-10 h-10 mx-auto mb-2 opacity-50" />
      <p>No submissions yet</p>
    </div>
  </div>
</template>
