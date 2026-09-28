<script setup lang="ts">
// One URL, two pages: on the accounts origin (central sign-in) it's the account itself —
// password, passkeys, your sites, data export, deletion. On a site's own domain it's that
// site's membership and notification settings (plus, on a single-site install, the
// account's own settings, which there live on the site itself). See useAccounts.
definePageMeta({ layout: false, middleware: ['auth'] })

const { isAccountsHost } = useAccounts()
</script>

<template>
  <NuxtLayout :name="isAccountsHost ? 'auth' : 'default'">
    <AccountsAccountHome v-if="isAccountsHost" />
    <AccountSiteAccount v-else />
  </NuxtLayout>
</template>
