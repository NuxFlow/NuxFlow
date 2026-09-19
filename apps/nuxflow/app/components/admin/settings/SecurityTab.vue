<script setup lang="ts">
import type { SecurityState } from '~/types/admin-settings'

const security = defineModel<SecurityState>('security', { required: true })

const auth = useAuthStore()
const toast = useToast()
const changingPassword = ref(false)
const passwordChangedSuccess = ref(false)
const redirectCountdown = ref(3)

async function changePassword() {
  if (!security.value.currentPassword || !security.value.newPassword) {
    toast.add({ title: 'Please fill in all password fields', color: 'error' })
    return
  }
  if (security.value.newPassword !== security.value.confirmPassword) {
    toast.add({ title: 'New passwords do not match', color: 'error' })
    return
  }
  if (security.value.newPassword.length < 8) {
    toast.add({ title: 'Password must be at least 8 characters long', color: 'error' })
    return
  }

  changingPassword.value = true
  try {
    await $fetch('/api/auth/change-password', {
      method: 'POST',
      body: {
        currentPassword: security.value.currentPassword,
        newPassword: security.value.newPassword,
        revokeOtherSessions: true,
      },
    })

    // Clear fields
    security.value.currentPassword = ''
    security.value.newPassword = ''
    security.value.confirmPassword = ''

    // Set success state
    passwordChangedSuccess.value = true
    toast.add({ title: 'Password updated successfully!', color: 'success' })

    // Set a countdown to sign out and log back in
    const interval = setInterval(() => {
      redirectCountdown.value--
      if (redirectCountdown.value <= 0) {
        clearInterval(interval)
        auth.signOut()
      }
    }, 1000)
  } catch (err: unknown) {
    const errMsg = (err as { data?: { message?: string } })?.data?.message ?? 'Failed to update password. Verify your current password.'
    toast.add({ title: errMsg, color: 'error' })
  } finally {
    changingPassword.value = false
  }
}
</script>

<template>
  <UAlert
    v-if="passwordChangedSuccess"
    icon="i-lucide-circle-check"
    color="success"
    variant="soft"
    title="Password updated successfully!"
    :description="`Your password has been changed. Logging you out in ${redirectCountdown} seconds to re-authenticate with your new password...`"
    class="mb-4"
  />

  <UCard>
    <template #header>
      <p class="text-sm font-semibold text-gray-900 dark:text-white">Change password</p>
    </template>
    <div class="space-y-4">
      <p class="text-sm text-gray-500 dark:text-gray-400">
        Update your account password securely. Once changed, you will be signed out of any other active browser sessions.
      </p>

      <UFormField label="Current password" required>
        <UInput v-model="security.currentPassword" type="password" placeholder="••••••••" class="w-full" :disabled="passwordChangedSuccess" />
      </UFormField>

      <UFormField label="New password" required hint="Must be at least 8 characters">
        <UInput v-model="security.newPassword" type="password" placeholder="••••••••" class="w-full" :disabled="passwordChangedSuccess" />
      </UFormField>

      <UFormField label="Confirm new password" required>
        <UInput v-model="security.confirmPassword" type="password" placeholder="••••••••" class="w-full" :disabled="passwordChangedSuccess" />
      </UFormField>
    </div>
    <template #footer>
      <div class="flex justify-end">
        <UButton
          :loading="changingPassword"
          :disabled="passwordChangedSuccess || !security.currentPassword || !security.newPassword || security.newPassword !== security.confirmPassword"
          @click="changePassword"
        >
          Update password
        </UButton>
      </div>
    </template>
  </UCard>

  <ClientOnly>
    <div class="mt-6">
      <AdminPasskeyManager />
    </div>
    <div class="mt-6">
      <AdminLinkedAccountsManager />
    </div>
  </ClientOnly>
</template>
