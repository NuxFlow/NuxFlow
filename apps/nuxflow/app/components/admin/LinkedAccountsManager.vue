<script setup lang="ts">
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const client = useAuthClient() as any
const toast = useToast()
const route = useRoute()

interface LinkedAccount {
  id: string
  accountId: string
  providerId: string
  createdAt: string
}

const PROVIDERS = [
  { id: 'google', label: 'Google', icon: 'i-simple-icons-google' },
  { id: 'github', label: 'GitHub', icon: 'i-simple-icons-github' },
]

const accounts = ref<LinkedAccount[]>([])
const loading = ref(true)
const linking = ref<string | null>(null)
const unlinking = ref<string | null>(null)

const linkedProviderIds = computed(() => new Set(accounts.value.map(a => a.providerId)))
const hasPasswordAccount = computed(() => linkedProviderIds.value.has('credential'))

function formatDate(dateStr?: string) {
  if (!dateStr) return 'N/A'
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return 'N/A'
  try {
    return date.toLocaleDateString(undefined, { dateStyle: 'medium' })
  }
  catch {
    return date.toLocaleDateString()
  }
}

async function fetchAccounts() {
  loading.value = true
  try {
    const res = await client.listAccounts()
    if (res?.error) {
      console.error('Failed to load linked accounts:', res.error)
      accounts.value = []
      return
    }
    accounts.value = (res?.data ?? []) as LinkedAccount[]
  }
  catch (err) {
    console.error('Failed to load linked accounts:', err)
    accounts.value = []
  }
  finally {
    loading.value = false
  }
}

async function linkProvider(providerId: string) {
  linking.value = providerId
  try {
    await client.linkSocial({
      provider: providerId,
      callbackURL: `${window.location.origin}/admin/settings?tab=Security`,
    })
    // Browser redirects to OAuth — execution stops here
  }
  catch (err: unknown) {
    const msg = (err as { message?: string })?.message ?? 'Failed to connect provider'
    toast.add({ title: msg, color: 'error' })
    linking.value = null
  }
}

async function unlinkProvider(providerId: string) {
  // Never allow removing the last auth method
  const remaining = accounts.value.filter(a => a.providerId !== providerId)
  if (remaining.length === 0) {
    toast.add({
      title: 'Cannot disconnect your only login method',
      description: 'Set a password or connect another provider first.',
      color: 'error',
    })
    return
  }

  unlinking.value = providerId
  try {
    const res = await client.unlinkAccount({ providerId })
    if (res?.error) {
      toast.add({ title: res.error.message ?? 'Failed to disconnect provider', color: 'error' })
      return
    }
    toast.add({ title: 'Provider disconnected successfully', color: 'success' })
    await fetchAccounts()
  }
  catch (err: unknown) {
    const msg = (err as { message?: string })?.message ?? 'Failed to disconnect provider'
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    unlinking.value = null
  }
}

// Show a toast if Better Auth redirected back with a linking error
onMounted(async () => {
  const error = route.query.error as string | undefined
  if (error) {
    const messages: Record<string, string> = {
      'account-already-linked': 'That provider account is already linked to another user.',
      'provider-not-found': 'Provider not found or not enabled.',
    }
    toast.add({ title: messages[error] ?? `Could not connect provider: ${error}`, color: 'error' })
  }
  await fetchAccounts()
})
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm font-semibold text-gray-900 dark:text-white">Connected Social Accounts</p>
          <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Link a social provider to sign in without a password.
          </p>
        </div>
        <UIcon name="i-lucide-link" class="w-6 h-6 text-primary-500" />
      </div>
    </template>

    <div class="space-y-4">
      <div v-if="loading" class="flex items-center justify-center py-6 space-x-2">
        <UIcon name="i-lucide-loader-2" class="w-5 h-5 text-primary-500 animate-spin" />
        <p class="text-xs text-gray-400">Loading connected accounts…</p>
      </div>

      <template v-else>
        <!-- Email / password row -->
        <div class="flex items-center justify-between p-3.5 rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/30">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
              <UIcon name="i-lucide-mail" class="w-5 h-5 text-gray-500" />
            </div>
            <div>
              <p class="text-sm font-medium text-gray-900 dark:text-white">Email &amp; Password</p>
              <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {{ hasPasswordAccount ? 'Active — change password in the section above' : 'Not set' }}
              </p>
            </div>
          </div>
          <UBadge :color="hasPasswordAccount ? 'success' : 'neutral'" variant="soft" size="sm">
            {{ hasPasswordAccount ? 'Connected' : 'Not set' }}
          </UBadge>
        </div>

        <!-- OAuth provider rows -->
        <div
          v-for="provider in PROVIDERS"
          :key="provider.id"
          class="flex items-center justify-between p-3.5 rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/30"
        >
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
              <UIcon :name="provider.icon" class="w-5 h-5 text-gray-700 dark:text-gray-300" />
            </div>
            <div>
              <p class="text-sm font-medium text-gray-900 dark:text-white">{{ provider.label }}</p>
              <p v-if="linkedProviderIds.has(provider.id)" class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Connected {{ formatDate(accounts.find(a => a.providerId === provider.id)?.createdAt) }}
              </p>
              <p v-else class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Not connected</p>
            </div>
          </div>

          <div>
            <UButton
              v-if="!linkedProviderIds.has(provider.id)"
              size="sm"
              variant="outline"
              :loading="linking === provider.id"
              icon="i-lucide-plus"
              @click="linkProvider(provider.id)"
            >
              Connect
            </UButton>
            <UButton
              v-else
              size="sm"
              color="error"
              variant="ghost"
              :loading="unlinking === provider.id"
              icon="i-lucide-unlink"
              :disabled="accounts.filter(a => a.providerId !== provider.id).length === 0"
              :title="accounts.filter(a => a.providerId !== provider.id).length === 0
                ? 'Cannot disconnect your only login method'
                : `Disconnect ${provider.label}`"
              @click="unlinkProvider(provider.id)"
            >
              Disconnect
            </UButton>
          </div>
        </div>

        <p v-if="!hasPasswordAccount" class="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
          <UIcon name="i-lucide-triangle-alert" class="w-3.5 h-3.5 shrink-0" />
          You have no password set. If you disconnect all social providers you will be locked out.
        </p>
      </template>
    </div>
  </UCard>
</template>
