<script setup lang="ts">
// The account page on the accounts origin (central sign-in): who you are, the sites you
// belong to, and everything account-wide — password, passkeys, connected sign-in methods,
// your data, deleting the account. Nothing here is specific to one site.
const { user } = useUserSession()
const auth = useAuthStore()

interface UserSite { id: string; name: string; domain: string; role: string; origin: string }
const { data } = await useFetch<{ sites: UserSite[] }>('/api/accounts/sites', {
  headers: useRequestHeaders(['cookie']),
  default: () => ({ sites: [] }),
})

function siteLink(site: UserSite): string {
  const staff = !['member', 'viewer'].includes(site.role)
  // Through the site's own sign-in handoff, so it lands signed in.
  return `${site.origin}/_nuxflow/auth/start?${new URLSearchParams({ return_to: staff ? '/admin' : '/account' })}`
}
</script>

<template>
  <div class="space-y-6">
    <div class="text-center">
      <UAvatar :src="user?.image ?? undefined" :alt="user?.name" size="xl" class="mb-3" />
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ user?.name }}</h1>
      <p class="text-sm text-gray-500">{{ user?.email }}</p>
      <p class="mt-2 text-xs text-gray-400">One account for every site on this platform. This is the only place you'll ever enter your password.</p>
    </div>

    <UCard>
      <template #header>
        <p class="text-sm font-semibold text-gray-900 dark:text-white">Your sites</p>
      </template>
      <ul v-if="data.sites.length" class="divide-y divide-gray-100 dark:divide-gray-800">
        <li v-for="site in data.sites" :key="site.id" class="flex items-center justify-between gap-3 py-2">
          <div class="min-w-0">
            <p class="text-sm font-medium text-gray-900 dark:text-white truncate">{{ site.name }}</p>
            <p class="text-xs text-gray-400 truncate">{{ site.domain }} · {{ site.role.replace('_', ' ') }}</p>
          </div>
          <UButton :to="siteLink(site)" external size="xs" variant="soft" trailing-icon="i-lucide-arrow-up-right">Open</UButton>
        </li>
      </ul>
      <p v-else class="text-sm text-gray-500">You're not a member of any site yet.</p>
    </UCard>

    <AccountSecurityPanel />
    <AccountDataAndDeletion />

    <UButton block variant="ghost" color="neutral" icon="i-lucide-log-out" @click="auth.signOut()">
      Sign out of every site
    </UButton>
  </div>
</template>
