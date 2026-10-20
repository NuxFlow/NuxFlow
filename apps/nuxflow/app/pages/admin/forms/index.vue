<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })

type FormRow = { id: string; name: string; slug: string; status: string; updatedAt: string; submissionCount: number; newCount: number }

// The contact form behind the Contact Form block: created automatically, fixed fields, so
// it opens its inbox rather than the form builder.
const isBuiltIn = (row: FormRow) => row.slug === 'contact'
const { data } = await useFetch<{ forms: FormRow[] }>('/api/v1/forms')
const items = computed(() => data.value?.forms ?? [])

type Color = 'success' | 'neutral' | 'error' | 'primary'
const statusColor: Record<string, Color> = { active: 'success', draft: 'neutral', closed: 'error' }

const columns = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'status', header: 'Status' },
  { accessorKey: 'submissionCount', header: 'Submissions' },
  { accessorKey: 'updatedAt', header: 'Updated' },
  { id: 'actions', header: actionsHeader },
]
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-bold text-gray-900 dark:text-white">Forms</h1>
      <UButton to="/admin/forms/new/edit" icon="i-lucide-plus">New form</UButton>
    </div>

    <UCard>
      <UTable :data="items" :columns="columns">
        <template #name-cell="{ row }">
          <div class="flex items-center gap-2">
            <NuxtLink
              :to="isBuiltIn(row.original) ? `/admin/forms/${row.original.id}/submissions` : `/admin/forms/${row.original.id}/edit`"
              class="font-medium text-gray-900 dark:text-white hover:text-primary-500"
            >
              {{ row.original.name }}
            </NuxtLink>
            <UBadge v-if="isBuiltIn(row.original)" color="neutral" variant="outline" size="xs" title="Used by the Contact Form block. Its fields are fixed.">Built-in</UBadge>
          </div>
        </template>
        <template #status-cell="{ row }">
          <UBadge :color="statusColor[row.original.status] ?? 'neutral'" variant="soft" size="xs" class="capitalize">{{ row.original.status }}</UBadge>
        </template>
        <template #submissionCount-cell="{ row }">
          <NuxtLink :to="`/admin/forms/${row.original.id}/submissions`" class="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 hover:text-primary-500">
            {{ row.original.submissionCount }}
            <UBadge v-if="row.original.newCount" color="warning" variant="soft" size="xs">{{ row.original.newCount }} new</UBadge>
          </NuxtLink>
        </template>
        <template #updatedAt-cell="{ row }">
          <span class="text-sm text-gray-400">{{ new Date(row.original.updatedAt).toLocaleDateString() }}</span>
        </template>
        <template #actions-cell="{ row }">
          <div class="flex gap-1 justify-end">
            <UButton :to="`/admin/forms/${row.original.id}/submissions`" variant="ghost" size="xs" icon="i-lucide-inbox" :aria-label="`View submissions for ${row.original.name}`" />
            <UButton v-if="!isBuiltIn(row.original)" :to="`/admin/forms/${row.original.id}/edit`" variant="ghost" size="xs" icon="i-lucide-pencil" :aria-label="`Edit ${row.original.name}`" />
          </div>
        </template>
      </UTable>
    </UCard>
  </div>
</template>
