<script setup lang="ts">
import { fetchAdminAccess } from '~/composables/useAdminAccess'

definePageMeta({ layout: 'admin', middleware: ['auth'] })
useHead({ title: 'Access Denied' })

// Two different situations land here. With a role on this site, the section is just above
// that role and the dashboard is a real way back. With no role at all (signed in with an
// account that belongs to *other* sites), /admin itself is off limits — linking to it
// bounced straight back here, so the button looked dead. Offer the site's public pages and
// the account's own list of sites instead.
const access = await fetchAdminAccess()
const noSiteRole = !access?.role && !access?.isSuperAdmin
const { central, accountsLink } = useAccounts()
</script>

<template>
  <div class="max-w-md mx-auto text-center space-y-4 py-16">
    <div class="w-14 h-14 rounded-2xl bg-red-50 dark:bg-red-900/30 flex items-center justify-center mx-auto">
      <UIcon name="i-lucide-shield-x" class="w-7 h-7 text-red-500" />
    </div>
    <div v-if="noSiteRole">
      <h1 class="text-xl font-bold text-gray-900 dark:text-white">You don't have access to this site</h1>
      <p class="text-sm text-gray-500 mt-1">
        You're signed in, but your account isn't a member of this site's team. If you should be, ask one of its admins to invite you.
      </p>
    </div>
    <div v-else>
      <h1 class="text-xl font-bold text-gray-900 dark:text-white">You don't have access to this</h1>
      <p class="text-sm text-gray-500 mt-1">
        Your role on this site doesn't include this section. If you think that's wrong, ask a site admin to check your role under Users.
      </p>
    </div>
    <div v-if="noSiteRole" class="flex flex-wrap justify-center gap-2">
      <UButton v-if="central" :to="accountsLink('/account')" external icon="i-lucide-layout-grid">
        Your sites
      </UButton>
      <UButton to="/" external icon="i-lucide-home" variant="soft">
        Go to this site's homepage
      </UButton>
    </div>
    <UButton v-else to="/admin" icon="i-lucide-arrow-left" variant="soft">
      Back to dashboard
    </UButton>
  </div>
</template>
