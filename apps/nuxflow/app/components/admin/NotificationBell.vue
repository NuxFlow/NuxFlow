<script setup lang="ts">
const { data, refresh } = await useFetch('/api/v1/notifications')
const notifications = computed(() => data.value?.notifications ?? [])
const unread = computed(() => notifications.value.filter((n: { readAt: string | null }) => !n.readAt).length)
const open = ref(false)

async function markRead(id: string) {
  await $fetch(`/api/v1/notifications/${id}/read`, { method: 'POST' })
  await refresh()
}
</script>

<template>
  <div class="relative">
    <UButton variant="ghost" size="sm" @click="open = !open">
      <div class="relative">
        <UIcon name="i-lucide-bell" class="w-5 h-5" />
        <span
          v-if="unread > 0"
          class="absolute -top-1 -right-1 w-4 h-4 bg-primary-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center"
        >
          {{ unread > 9 ? '9+' : unread }}
        </span>
      </div>
    </UButton>

    <div
      v-if="open"
      class="absolute right-0 top-10 w-80 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-lg z-50 overflow-hidden"
    >
      <div class="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
        <p class="text-sm font-semibold">Notifications</p>
        <UButton v-if="unread" variant="ghost" size="xs" @click="() => refresh()">Mark all read</UButton>
      </div>
      <div class="divide-y divide-gray-100 dark:divide-gray-800 max-h-80 overflow-y-auto">
        <div
          v-for="notif in notifications.slice(0, 10)"
          :key="notif.id"
          class="px-4 py-3 flex gap-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          :class="!notif.readAt ? 'bg-primary-50 dark:bg-primary-950' : ''"
          @click="markRead(notif.id)"
        >
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-gray-900 dark:text-white truncate">{{ notif.title }}</p>
            <p class="text-xs text-gray-500 mt-0.5 truncate">{{ notif.body }}</p>
          </div>
        </div>
        <div v-if="!notifications.length" class="px-4 py-8 text-center text-sm text-gray-400">
          No notifications
        </div>
      </div>
    </div>
  </div>
</template>
