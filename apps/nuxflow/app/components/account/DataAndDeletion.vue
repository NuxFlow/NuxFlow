<script setup lang="ts">
// Account-wide actions: download everything the platform holds about you (every site),
// and delete the account. The server only accepts these with a session on the accounts
// origin (or on a single-site install) — see requireAccountSession.
const toast = useToast()
const confirmOpen = ref(false)
const confirmText = ref('')
const deleting = ref(false)

async function deleteAccount() {
  deleting.value = true
  try {
    await $fetch('/api/v1/account', { method: 'DELETE' })
    window.location.href = '/login'
  } catch (e: unknown) {
    toast.add({ title: 'Your account wasn\'t deleted', description: getErrorMessage(e, 'Please try again.'), color: 'error' })
    deleting.value = false
  }
}
</script>

<template>
  <UCard>
    <template #header>
      <p class="text-sm font-semibold text-gray-900 dark:text-white">Your data</p>
    </template>
    <div class="space-y-4">
      <div class="flex items-center justify-between gap-4">
        <div>
          <p class="text-sm font-medium text-gray-900 dark:text-white">Download your data</p>
          <p class="text-xs text-gray-400 mt-0.5">A JSON file with your profile, site memberships, comments, form submissions and subscriptions across every site.</p>
        </div>
        <UButton variant="outline" size="sm" to="/api/v1/account/data-export" external download>Download</UButton>
      </div>
      <div class="flex items-center justify-between gap-4">
        <div>
          <p class="text-sm font-medium text-red-600 dark:text-red-400">Delete account</p>
          <p class="text-xs text-gray-400 mt-0.5">Removes your account from every site. Active paid subscriptions are cancelled first.</p>
        </div>
        <UButton color="error" variant="soft" size="sm" @click="confirmOpen = true">Delete</UButton>
      </div>
    </div>
  </UCard>

  <UModal v-model:open="confirmOpen" title="Delete your account?">
    <template #body>
      <div class="space-y-3">
        <p class="text-sm text-gray-600 dark:text-gray-300">
          This can't be undone. You'll lose access to every site you belong to, and your comments and form answers are erased.
        </p>
        <UFormField label="Type DELETE to confirm">
          <UInput v-model="confirmText" class="w-full" autocomplete="off" />
        </UFormField>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton variant="ghost" color="neutral" @click="confirmOpen = false">Cancel</UButton>
        <UButton color="error" :loading="deleting" :disabled="confirmText !== 'DELETE'" @click="deleteAccount">Delete account</UButton>
      </div>
    </template>
  </UModal>
</template>
