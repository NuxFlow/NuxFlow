<script setup lang="ts">
const toast = useToast()

interface Submission {
  id: string
  data: { name?: string; email?: string; subject?: string; message?: string }
  status: 'new' | 'read' | 'spam' | 'archived'
  ipAddress: string | null
  createdAt: string
}

const { data, refresh } = await useFetch<{ submissions: Submission[] }>('/api/v1/contact/submissions')
const submissions = computed(() => data.value?.submissions ?? [])

const selected = ref<Submission | null>(null)

const statusColor: Record<string, 'yellow' | 'green' | 'red' | 'neutral'> = {
  new: 'yellow',
  read: 'green',
  spam: 'red',
  archived: 'neutral',
}

async function setStatus(id: string, status: Submission['status']) {
  try {
    await $fetch(`/api/v1/contact/submissions/${id}`, {
      method: 'PATCH',
      body: { status },
    })
    await refresh()
    if (selected.value?.id === id) selected.value = null
    toast.add({ title: `Marked as ${status}`, color: 'green' })
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message ?? 'Update failed'
    toast.add({ title: msg, color: 'red' })
  }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-bold text-gray-900 dark:text-white">Contact Form</h1>
      <UBadge :color="submissions.filter(s => s.status === 'new').length ? 'yellow' : 'neutral'" variant="soft">
        {{ submissions.filter(s => s.status === 'new').length }} new
      </UBadge>
    </div>

    <div v-if="submissions.length === 0" class="text-center py-16 text-gray-400">
      <UIcon name="i-lucide-inbox" class="w-10 h-10 mx-auto mb-3 opacity-40" />
      <p>No submissions yet.</p>
    </div>

    <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <!-- Submission list -->
      <div class="space-y-2">
        <UCard
          v-for="sub in submissions"
          :key="sub.id"
          class="cursor-pointer transition-shadow"
          :class="selected?.id === sub.id ? 'ring-2 ring-primary-500' : ''"
          @click="selected = sub"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="font-medium text-sm text-gray-900 dark:text-white truncate">
                {{ sub.data.name ?? 'Unknown' }}
              </p>
              <p class="text-xs text-gray-400 truncate">{{ sub.data.email }}</p>
              <p class="text-xs text-gray-500 mt-0.5 truncate">{{ sub.data.subject || '(no subject)' }}</p>
            </div>
            <div class="flex flex-col items-end gap-1 shrink-0">
              <UBadge :color="statusColor[sub.status]" variant="soft" size="xs">{{ sub.status }}</UBadge>
              <span class="text-xs text-gray-400">{{ formatDate(sub.createdAt) }}</span>
            </div>
          </div>
        </UCard>
      </div>

      <!-- Detail pane -->
      <div v-if="selected" class="space-y-4">
        <UCard>
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <p class="font-semibold text-gray-900 dark:text-white">{{ selected.data.name }}</p>
              <UBadge :color="statusColor[selected.status]" variant="soft" size="xs">{{ selected.status }}</UBadge>
            </div>
            <div class="text-sm text-gray-500 space-y-0.5">
              <p><span class="font-medium text-gray-700 dark:text-gray-300">Email:</span> {{ selected.data.email }}</p>
              <p v-if="selected.data.subject"><span class="font-medium text-gray-700 dark:text-gray-300">Subject:</span> {{ selected.data.subject }}</p>
              <p><span class="font-medium text-gray-700 dark:text-gray-300">Received:</span> {{ formatDate(selected.createdAt) }}</p>
            </div>
            <div class="pt-2 border-t border-gray-100 dark:border-gray-800">
              <p class="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{{ selected.data.message }}</p>
            </div>
          </div>
        </UCard>

        <div class="flex flex-wrap gap-2">
          <UButton v-if="selected.status !== 'read'" size="xs" color="green" variant="outline" icon="i-lucide-check" @click="setStatus(selected.id, 'read')">Mark read</UButton>
          <UButton v-if="selected.status !== 'archived'" size="xs" color="neutral" variant="outline" icon="i-lucide-archive" @click="setStatus(selected.id, 'archived')">Archive</UButton>
          <UButton v-if="selected.status !== 'spam'" size="xs" color="red" variant="outline" icon="i-lucide-shield-off" @click="setStatus(selected.id, 'spam')">Mark spam</UButton>
          <UButton size="xs" variant="ghost" :href="`mailto:${selected.data.email}`" icon="i-lucide-mail">Reply</UButton>
        </div>
      </div>

      <div v-else class="hidden md:flex items-center justify-center text-gray-400 text-sm">
        Select a submission to view details
      </div>
    </div>
  </div>
</template>
