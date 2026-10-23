<script setup lang="ts">
const { user } = useUserSession()
const { isSupported, isSubscribed, isLoading, error: pushError, subscribe, refreshStatus } = usePushNotifications()

// Cookie persists the "maybe later" dismissal for 30 days
const dismissed = useCookie('nuxflow_push_dismissed', { maxAge: 60 * 60 * 24 * 30 })
const vapidConfigured = ref(false)
const show = ref(false)

onMounted(async () => {
  if (!isSupported.value || !user.value || dismissed.value) return

  // Only show if VAPID is configured on this site
  try {
    const { publicKey } = await $fetch<{ publicKey: string | null }>('/api/v1/push/vapid-public-key')
    if (!publicKey) return
    vapidConfigured.value = true
  } catch { return }

  await refreshStatus()
  if (!isSubscribed.value) show.value = true
})

async function allow() {
  const ok = await subscribe()
  if (ok) show.value = false
}

function dismiss() {
  dismissed.value = '1'
  show.value = false
}
</script>

<template>
  <Transition
    enter-active-class="transition-transform duration-300"
    enter-from-class="translate-y-full"
    leave-active-class="transition-transform duration-300"
    leave-to-class="translate-y-full"
  >
    <div
      v-if="show"
      class="fixed bottom-0 left-0 right-0 z-50 p-4 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 shadow-lg"
    >
      <div class="max-w-4xl mx-auto flex items-center gap-4 flex-wrap">
        <UIcon name="i-lucide-bell" class="w-5 h-5 text-primary-500 shrink-0" />
        <p class="flex-1 text-sm text-gray-600 dark:text-gray-400 min-w-0">
          Stay up to date — enable browser notifications to get alerts when new content is published.
          <span v-if="pushError" class="block text-red-500 mt-1">{{ pushError }}</span>
        </p>
        <div class="flex gap-2 shrink-0">
          <UButton size="sm" variant="outline" :disabled="isLoading" @click="dismiss">Maybe later</UButton>
          <UButton size="sm" :loading="isLoading" @click="allow">Allow notifications</UButton>
        </div>
      </div>
    </div>
  </Transition>
</template>
