<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })
useHead({ title: 'Comments' })

interface Comment {
  id: string
  body: string
  status: 'pending' | 'approved' | 'spam' | 'trash'
  createdAt: string
  guestName: string | null
  guestEmail: string | null
  authorName: string | null
  authorEmail: string | null
  itemId: string
  itemTitle: string | null
  itemSlug: string | null
}

const statusTab = ref<'pending' | 'approved' | 'spam' | 'trash'>('pending')
const tabs = [
  { label: 'Pending', value: 'pending', color: 'yellow' },
  { label: 'Approved', value: 'approved', color: 'green' },
  { label: 'Spam', value: 'spam', color: 'red' },
  { label: 'Trash', value: 'trash', color: 'gray' },
]

const { data, refresh, pending } = await useFetch<{ comments: Comment[] }>('/api/v1/comments', {
  query: computed(() => ({ status: statusTab.value })),
  watch: [statusTab],
  default: () => ({ comments: [] }),
})

async function setStatus(id: string, status: Comment['status']) {
  await $fetch(`/api/v1/comments/${id}`, { method: 'PATCH', body: { status } })
  await refresh()
}

async function deleteComment(id: string) {
  await $fetch(`/api/v1/comments/${id}`, { method: 'DELETE' })
  await refresh()
}

function authorLabel(c: Comment) {
  return c.authorName ?? c.guestName ?? 'Anonymous'
}
function authorEmail(c: Comment) {
  return c.authorEmail ?? c.guestEmail ?? ''
}

type UColor = 'yellow' | 'green' | 'red' | 'gray' | 'blue' | 'orange'
const statusColors: Record<string, UColor> = {
  pending: 'yellow',
  approved: 'green',
  spam: 'red',
  trash: 'gray',
}
</script>

<template>
  <div class="max-w-5xl mx-auto space-y-6">
    <div>
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Comments</h1>
      <p class="text-sm text-gray-500 mt-0.5">Review and moderate reader comments</p>
    </div>

    <!-- Status tabs -->
    <div class="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl w-fit">
      <button
        v-for="tab in tabs"
        :key="tab.value"
        class="px-4 py-1.5 rounded-lg text-sm font-medium transition-colors"
        :class="statusTab === tab.value
          ? 'bg-white dark:bg-gray-900 shadow-sm text-gray-900 dark:text-white'
          : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'"
        @click="statusTab = tab.value as Comment['status']"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- Loading -->
    <div v-if="pending" class="flex justify-center py-12">
      <UIcon name="i-lucide-loader-2" class="w-6 h-6 animate-spin text-gray-400" />
    </div>

    <!-- Empty state -->
    <div v-else-if="data.comments.length === 0" class="text-center py-16 text-gray-400">
      <UIcon name="i-lucide-message-circle" class="w-12 h-12 mx-auto mb-3 opacity-30" />
      <p class="text-sm">No {{ statusTab }} comments</p>
    </div>

    <!-- Comment list -->
    <div v-else class="space-y-3">
      <UCard v-for="comment in data.comments" :key="comment.id">
        <div class="space-y-3">
          <!-- Meta row -->
          <div class="flex items-start justify-between gap-4">
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center shrink-0 text-xs font-medium uppercase">
                {{ authorLabel(comment).charAt(0) }}
              </div>
              <div class="min-w-0">
                <p class="text-sm font-medium truncate">{{ authorLabel(comment) }}</p>
                <p class="text-xs text-gray-400 truncate">{{ authorEmail(comment) }}</p>
              </div>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <UBadge :color="statusColors[comment.status]" :label="comment.status" variant="soft" size="xs" />
              <span class="text-xs text-gray-400">{{ new Date(comment.createdAt).toLocaleDateString() }}</span>
            </div>
          </div>

          <!-- Content -->
          <p class="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{{ comment.body }}</p>

          <!-- On post -->
          <p v-if="comment.itemTitle" class="text-xs text-gray-400">
            On: <NuxtLink :to="`/admin/content/${comment.itemId}`" class="text-primary-500 hover:underline">{{ comment.itemTitle }}</NuxtLink>
          </p>

          <!-- Actions -->
          <div class="flex items-center gap-2 pt-1">
            <template v-if="comment.status !== 'approved'">
              <UButton size="xs" color="green" variant="soft" icon="i-lucide-check" @click="setStatus(comment.id, 'approved')">
                Approve
              </UButton>
            </template>
            <template v-if="comment.status !== 'pending'">
              <UButton size="xs" variant="soft" icon="i-lucide-clock" @click="setStatus(comment.id, 'pending')">
                Pending
              </UButton>
            </template>
            <template v-if="comment.status !== 'spam'">
              <UButton size="xs" color="orange" variant="soft" icon="i-lucide-shield-x" @click="setStatus(comment.id, 'spam')">
                Spam
              </UButton>
            </template>
            <template v-if="comment.status !== 'trash'">
              <UButton size="xs" color="gray" variant="soft" icon="i-lucide-trash-2" @click="setStatus(comment.id, 'trash')">
                Trash
              </UButton>
            </template>
            <UButton size="xs" color="red" variant="ghost" icon="i-lucide-x" @click="deleteComment(comment.id)">
              Delete
            </UButton>
          </div>
        </div>
      </UCard>
    </div>
  </div>
</template>
