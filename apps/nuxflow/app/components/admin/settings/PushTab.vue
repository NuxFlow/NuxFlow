<script setup lang="ts">
import type { PushState } from '~/types/admin-settings'

const push = defineModel<PushState>('push', { required: true })
defineProps<{
  saving: boolean
  onSave: () => Promise<void>
}>()

const pushSubscriberCount = ref(0)
const { loading: generatingVapid, run: runGenerateVapid } = useAdminAction()
const { loading: sendingTestPush, run: runTestPush } = useAdminAction()
const { loading: broadcasting, run: runBroadcast } = useAdminAction()
const broadcastTitle = ref('')
const broadcastBody = ref('')
const broadcastUrl = ref('')

async function generateVapidKeys() {
  const result = await runGenerateVapid(
    () => $fetch<{ publicKey: string }>('/api/v1/push/vapid-keys', { method: 'POST' }),
    { successTitle: 'VAPID keys generated', errorTitle: 'Failed to generate VAPID keys' },
  )
  if (result) push.value.vapidPublicKey = result.publicKey
}

async function sendTestPush() {
  await runTestPush(() => $fetch<unknown>('/api/v1/push/test', { method: 'POST' }), {
    successTitle: 'Test notification sent',
    errorTitle: 'Failed — make sure you have subscribed to push notifications',
  })
}

async function sendBroadcast() {
  if (!broadcastTitle.value || !broadcastBody.value) return
  // The callback resolves to `true` on success so clearing the fields below can check
  // an unambiguous signal, rather than trusting the fetch response body's own shape
  // (which could itself resolve to undefined on a legitimate 204/empty response).
  const ok = await runBroadcast(async () => {
    await $fetch<unknown>('/api/v1/push/broadcast', {
      method: 'POST',
      body: {
        title: broadcastTitle.value,
        body: broadcastBody.value,
        url: broadcastUrl.value || undefined,
      },
    })
    return true
  }, { successTitle: 'Notification broadcast sent', errorTitle: 'Broadcast failed' })
  if (ok) {
    broadcastTitle.value = ''
    broadcastBody.value = ''
    broadcastUrl.value = ''
  }
}

async function fetchPushSubscriberCount() {
  try {
    const { count } = await $fetch<{ count: number }>('/api/v1/push/subscribers')
    pushSubscriberCount.value = count
  } catch { /* ignore */ }
}

onMounted(() => fetchPushSubscriberCount())
</script>

<template>
  <!-- VAPID keys -->
  <UCard>
    <template #header>
      <div class="flex items-center justify-between">
        <p class="text-sm font-semibold text-gray-900 dark:text-white">VAPID keys</p>
        <UBadge v-if="push.vapidPublicKey" color="success" variant="soft">Configured</UBadge>
        <UBadge v-else color="neutral" variant="soft">Not configured</UBadge>
      </div>
    </template>
    <div class="space-y-4">
      <p class="text-sm text-gray-500 dark:text-gray-400">
        VAPID keys authenticate your server with browser push services. Generate once and leave them — regenerating invalidates all existing subscriber subscriptions.
      </p>
      <div v-if="push.vapidPublicKey" class="space-y-2">
        <p class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Public key</p>
        <p class="text-xs font-mono break-all bg-gray-50 dark:bg-gray-800 rounded-lg p-2 text-gray-700 dark:text-gray-300 select-all">{{ push.vapidPublicKey }}</p>
        <p class="text-xs text-gray-400">{{ pushSubscriberCount }} active subscriber{{ pushSubscriberCount !== 1 ? 's' : '' }}</p>
      </div>
      <div class="flex gap-2">
        <UButton
          v-if="!push.vapidPublicKey"
          icon="i-lucide-key"
          :loading="generatingVapid"
          @click="generateVapidKeys"
        >
          Generate keys
        </UButton>
        <UButton
          v-else
          icon="i-lucide-refresh-cw"
          variant="outline"
          color="error"
          :loading="generatingVapid"
          @click="generateVapidKeys"
        >
          Regenerate keys
        </UButton>
      </div>
    </div>
  </UCard>

  <!-- Event toggles -->
  <UCard>
    <template #header>
      <p class="text-sm font-semibold text-gray-900 dark:text-white">Notification events</p>
    </template>
    <div class="space-y-5">
      <div class="flex items-start justify-between gap-4">
        <div>
          <p class="text-sm font-medium text-gray-900 dark:text-white">New content published</p>
          <p class="text-xs text-gray-400 mt-0.5">Broadcast to all subscribers when a content item is first published.</p>
        </div>
        <USwitch v-model="push.eventsContentPublished" :disabled="!push.vapidPublicKey" />
      </div>
      <UDivider />
      <div class="flex items-start justify-between gap-4">
        <div>
          <p class="text-sm font-medium text-gray-900 dark:text-white">Payment confirmation</p>
          <p class="text-xs text-gray-400 mt-0.5">Notify the member when their subscription is activated.</p>
        </div>
        <USwitch v-model="push.eventsPaymentConfirmation" :disabled="!push.vapidPublicKey" />
      </div>
      <UDivider />
      <div class="flex items-start justify-between gap-4">
        <div>
          <p class="text-sm font-medium text-gray-900 dark:text-white">Form submission confirmation</p>
          <p class="text-xs text-gray-400 mt-0.5">Notify the logged-in member after they submit a contact form.</p>
        </div>
        <USwitch v-model="push.eventsFormSubmission" :disabled="!push.vapidPublicKey" />
      </div>
    </div>
    <template #footer>
      <div class="flex justify-end">
        <UButton :loading="saving" :disabled="!push.vapidPublicKey" @click="onSave">Save changes</UButton>
      </div>
    </template>
  </UCard>

  <!-- Test and manual broadcast -->
  <UCard>
    <template #header>
      <p class="text-sm font-semibold text-gray-900 dark:text-white">Send notification</p>
    </template>
    <div class="space-y-4">
      <div class="flex items-center justify-between gap-4">
        <div>
          <p class="text-sm font-medium text-gray-900 dark:text-white">Test push</p>
          <p class="text-xs text-gray-400 mt-0.5">Sends a test notification to your own browser (you must be subscribed).</p>
        </div>
        <UButton
          variant="outline"
          icon="i-lucide-send"
          size="sm"
          :loading="sendingTestPush"
          :disabled="!push.vapidPublicKey"
          @click="sendTestPush"
        >
          Send test
        </UButton>
      </div>

      <UDivider />

      <p class="text-sm font-medium text-gray-900 dark:text-white">Broadcast to all subscribers</p>
      <UFormField label="Title">
        <UInput v-model="broadcastTitle" placeholder="Notification title" :disabled="!push.vapidPublicKey" />
      </UFormField>
      <UFormField label="Message">
        <UTextarea v-model="broadcastBody" placeholder="Notification body text" :disabled="!push.vapidPublicKey" />
      </UFormField>
      <UFormField label="Link (optional)" hint="Absolute path e.g. /blog/my-post">
        <UInput v-model="broadcastUrl" placeholder="https://yoursite.com/page" :disabled="!push.vapidPublicKey" />
      </UFormField>
      <div class="flex justify-end">
        <UButton
          icon="i-lucide-megaphone"
          :loading="broadcasting"
          :disabled="!push.vapidPublicKey || !broadcastTitle || !broadcastBody"
          @click="sendBroadcast"
        >
          Broadcast
        </UButton>
      </div>
    </div>
  </UCard>
</template>
