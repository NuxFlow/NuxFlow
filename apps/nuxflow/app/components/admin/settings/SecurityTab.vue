<script setup lang="ts">
import type { SecurityState } from '~/types/admin-settings'

// Kept for the settings page's v-model contract; the panel manages its own form state.
defineModel<SecurityState>('security', { required: true })

const { central, accountsLink } = useAccounts()
</script>

<template>
  <!-- Under central sign-in the password, passkeys and linked accounts live only on the
       accounts origin — never on a site's own domain, where its admins can add scripts. -->
  <UCard v-if="central">
    <template #header>
      <p class="text-sm font-semibold text-gray-900 dark:text-white">Sign-in &amp; security</p>
    </template>
    <div class="space-y-3">
      <p class="text-sm text-gray-500 dark:text-gray-400">
        Your password, passkeys and connected Google/GitHub accounts are managed on your account page. It's the same account for every site on this platform, and it's the only place you'll ever be asked for your password.
      </p>
      <UButton :to="accountsLink('/account')" external icon="i-lucide-external-link" size="sm">
        Open account settings
      </UButton>
    </div>
  </UCard>
  <AccountSecurityPanel v-else />
</template>
