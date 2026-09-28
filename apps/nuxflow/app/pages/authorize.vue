<script setup lang="ts">
import type { SiteBranding } from '~/types/accounts'

// Step 2 of signing in to a site (see server/utils/site-auth.ts), on the accounts origin:
// a site's own domain sent the visitor here with `site` and `state`. Once they're signed
// in here, the server issues a one-time code and they go back to the site's callback.
//
// Members of the site continue straight through. For anyone else — including someone
// who arrived because some site sent them here uninvited — continuing is an explicit
// click, so no site can learn who a visitor is just by redirecting them through this page.
definePageMeta({ layout: 'auth' })

const route = useRoute()
const { isAccountsHost } = useAccounts()
if (!isAccountsHost) throw createError({ statusCode: 404, statusMessage: 'Not found' })

const siteId = typeof route.query.site === 'string' ? route.query.site : ''
const state = typeof route.query.state === 'string' ? route.query.state : ''
const wantsToJoin = route.query.intent === 'join'

interface AuthorizeInfo {
  site: SiteBranding
  user: { name: string; email: string; image: string | null } | null
  isMember: boolean
}

const { data, error: loadError } = await useFetch<AuthorizeInfo>('/api/accounts/authorize', {
  query: { site: siteId },
  headers: useRequestHeaders(['cookie']),
})

const continuing = ref(false)
const error = ref('')

// Not signed in here yet — sign in, then come back to this exact page.
if (data.value && !data.value.user) {
  await navigateTo(`/login?${new URLSearchParams({ site: siteId, next: route.fullPath })}`)
}

// Arrived without a `state` (e.g. from a "continue to your site" link after resetting a
// password): the handoff has to start on the site's own domain, which sets the state
// cookie this browser will be checked against.
if (data.value?.user && !state) {
  const params = new URLSearchParams({ return_to: wantsToJoin ? '/account' : '/admin' })
  if (wantsToJoin) params.set('intent', 'join')
  await navigateTo(`${data.value.site.origin}/_nuxflow/auth/start?${params}`, { external: true })
}

async function proceed(join = false) {
  continuing.value = true
  error.value = ''
  try {
    const { redirect } = await $fetch<{ redirect: string }>('/api/accounts/authorize', {
      method: 'POST',
      body: { site: siteId, state, join },
    })
    window.location.href = redirect
  } catch (e: unknown) {
    error.value = getErrorMessage(e, 'Could not continue to the site. Please try again.')
    continuing.value = false
  }
}

const { signOut } = useUserSession()
async function useAnotherAccount() {
  await signOut()
  await navigateTo(`/login?${new URLSearchParams({ site: siteId, next: route.fullPath })}`)
}

const canJoin = computed(() => Boolean(data.value && !data.value.isMember && data.value.site.allowRegistration))

// A member with nothing to decide goes straight through.
onMounted(() => {
  if (data.value?.user && state && data.value.isMember) void proceed()
})
</script>

<template>
  <div class="space-y-6">
    <div v-if="loadError" class="glass rounded-2xl p-6 text-center space-y-3">
      <UIcon name="i-lucide-circle-x" class="w-10 h-10 text-red-400 mx-auto" />
      <p class="font-semibold text-gray-900 dark:text-white">This site isn't available</p>
      <p class="text-sm text-gray-500">The link may be out of date, or the site may have been closed.</p>
      <UButton to="/account" variant="soft" size="sm">Go to your account</UButton>
    </div>

    <template v-else-if="data?.user">
      <AccountsSiteBrand
        :site="data.site"
        :heading="data.isMember ? `Signing you in to ${data.site.name}…` : `Continue to ${data.site.name}?`"
        :subheading="data.site.domain"
      />

      <div class="glass rounded-2xl p-6 space-y-4">
        <div class="flex items-center gap-3">
          <UAvatar :src="data.user.image ?? undefined" :alt="data.user.name" size="md" />
          <div class="min-w-0">
            <p class="text-sm font-medium text-gray-900 dark:text-white truncate">{{ data.user.name }}</p>
            <p class="text-xs text-gray-500 truncate">{{ data.user.email }}</p>
          </div>
        </div>

        <p v-if="!data.isMember" class="text-sm text-gray-600 dark:text-gray-400">
          <template v-if="canJoin && wantsToJoin">
            You're not a member of {{ data.site.name }} yet. Joining shares your name and email address with the site.
          </template>
          <template v-else>
            {{ data.site.name }} will see your name and email address. Only continue if you meant to sign in there.
          </template>
        </p>

        <UAlert v-if="error" color="error" variant="soft" :description="error" />

        <div class="flex flex-col gap-2">
          <UButton v-if="canJoin && wantsToJoin" block :loading="continuing" @click="proceed(true)">
            Join {{ data.site.name }}
          </UButton>
          <UButton v-else block :loading="continuing" @click="proceed(false)">
            Continue to {{ data.site.name }}
          </UButton>
          <UButton block variant="ghost" color="neutral" :disabled="continuing" @click="useAnotherAccount">
            Use a different account
          </UButton>
        </div>
      </div>
    </template>
  </div>
</template>
