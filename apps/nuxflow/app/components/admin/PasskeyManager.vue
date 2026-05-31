<script setup lang="ts">
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const client = useAuthClient() as any
const toast = useToast()

interface Passkey {
  id: string
  name?: string
  createdAt: string
  deviceType: string
}

const passkeys = ref<Passkey[]>([])
const loading = ref(true)
const registering = ref(false)
const passkeyName = ref('')

async function fetchPasskeys() {
  loading.value = true
  try {
    const res = await client.passkey.listUserPasskeys()
    passkeys.value = (res || []) as Passkey[]
  } catch (err) {
    console.error('Failed to load passkeys:', err)
  } finally {
    loading.value = false
  }
}

async function registerPasskey() {
  if (!passkeyName.value.trim()) {
    toast.add({ title: 'Please provide a name for this passkey', color: 'red' })
    return
  }

  registering.value = true
  try {
    const result = await client.passkey.addPasskey({
      name: passkeyName.value.trim()
    })
    
    if (result?.error) {
      toast.add({ title: result.error.message || 'Failed to register passkey', color: 'red' })
      return
    }

    toast.add({ title: 'Passkey registered successfully!', color: 'green' })
    passkeyName.value = ''
    await fetchPasskeys()
  } catch (err: unknown) {
    const errMsg = (err as { message?: string })?.message || 'Biometric registration cancelled or failed.'
    toast.add({ title: errMsg, color: 'red' })
  } finally {
    registering.value = false
  }
}

async function deletePasskey(id: string) {
  try {
    const result = await client.passkey.deletePasskey({ id })
    if (result?.error) {
      toast.add({ title: result.error.message || 'Failed to delete passkey', color: 'red' })
      return
    }

    toast.add({ title: 'Passkey deleted successfully', color: 'green' })
    await fetchPasskeys()
  } catch {
    toast.add({ title: 'Failed to delete passkey', color: 'red' })
  }
}

onMounted(() => {
  fetchPasskeys()
})
</script>

<template>
  <div class="space-y-6">
    <!-- Passkeys Card -->
    <UCard>
      <template #header>
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-semibold text-gray-900 dark:text-white">Passkeys & Passwordless Login</p>
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Use biometric authentication (Touch ID, Face ID) or security keys to sign in instantly.</p>
          </div>
          <UIcon name="i-lucide-fingerprint" class="w-6 h-6 text-primary-500 animate-pulse" />
        </div>
      </template>

      <!-- Active Passkeys List -->
      <div class="space-y-4">
        <div v-if="loading" class="flex flex-col items-center justify-center py-6 space-y-2">
          <UIcon name="i-lucide-loader-2" class="w-8 h-8 text-primary-500 animate-spin" />
          <p class="text-xs text-gray-400">Loading your secure passkeys...</p>
        </div>

        <div v-else-if="passkeys.length === 0" class="flex flex-col items-center justify-center py-8 px-4 rounded-xl border border-dashed border-gray-200 dark:border-gray-800 text-center">
          <div class="w-12 h-12 rounded-full bg-primary-50 dark:bg-primary-950/30 flex items-center justify-center mb-3">
            <UIcon name="i-lucide-shield-check" class="w-6 h-6 text-primary-500" />
          </div>
          <h3 class="text-sm font-medium text-gray-900 dark:text-white">No passkeys registered</h3>
          <p class="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-sm">You haven't added any passkeys to this account yet. Register one below to enable fast, biometric log-in.</p>
        </div>

        <div v-else class="space-y-3">
          <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider">Registered Passkeys</p>
          
          <div 
            v-for="pk in passkeys" 
            :key="pk.id" 
            class="flex items-center justify-between p-3.5 rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/30 transition-all hover:bg-gray-50 dark:hover:bg-gray-900/60"
          >
            <div class="flex items-center gap-3">
              <div class="w-9 h-9 rounded-lg bg-primary-50 dark:bg-primary-950/30 flex items-center justify-center">
                <UIcon :name="pk.deviceType === 'platform' ? 'i-lucide-smartphone' : 'i-lucide-key-round'" class="w-5 h-5 text-primary-500" />
              </div>
              <div>
                <p class="text-sm font-medium text-gray-900 dark:text-white">{{ pk.name || 'Unnamed Passkey' }}</p>
                <div class="flex items-center gap-2 mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                  <span>Created {{ new Date(pk.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' }) }}</span>
                  <span>•</span>
                  <UBadge size="sm" variant="soft" :color="pk.deviceType === 'platform' ? 'blue' : 'orange'">
                    {{ pk.deviceType === 'platform' ? 'Device Biometrics' : 'Security Key' }}
                  </UBadge>
                </div>
              </div>
            </div>
            
            <UButton 
              color="red" 
              variant="ghost" 
              icon="i-lucide-trash-2" 
              size="sm"
              class="hover:bg-red-50 dark:hover:bg-red-950/30"
              @click="deletePasskey(pk.id)"
            />
          </div>
        </div>

        <div class="border-t border-gray-100 dark:border-gray-800 my-4 pt-4" />

        <!-- Register Passkey Form -->
        <div class="space-y-4">
          <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider">Register a New Passkey</p>
          <div class="flex flex-col sm:flex-row gap-3">
            <UFormField class="flex-1" label="Passkey name (e.g. My Phone, Personal Laptop)">
              <UInput 
                v-model="passkeyName" 
                placeholder="e.g. Work MacBook TouchID" 
                class="w-full" 
                icon="i-lucide-tag"
                :disabled="registering"
              />
            </UFormField>
            <div class="flex items-end">
              <UButton 
                class="w-full sm:w-auto h-9" 
                icon="i-lucide-plus"
                :loading="registering"
                @click="registerPasskey"
              >
                Register Passkey
              </UButton>
            </div>
          </div>
        </div>
      </div>
    </UCard>
  </div>
</template>
