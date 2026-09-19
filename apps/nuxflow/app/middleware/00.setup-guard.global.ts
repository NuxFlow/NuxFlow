// Runs first among the three global middleware files (00./01./02. prefixes make the
// order explicit, rather than leaving it to alphabetical filename luck) so an
// unconfigured install redirects straight to /setup without also paying for
// 01.session.global.ts's and 02.admin-role-guard.global.ts's own fetches first on
// every single request to a site that isn't even set up yet.
export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path.startsWith('/api')) return

  const needsSetup = useState('setup:needs-setup', () => null as boolean | null)
  if (needsSetup.value === null) {
    try {
      const status = await $fetch<{ needsSetup: boolean }>('/api/v1/setup/status', {
        headers: useRequestHeaders(['host']),
      })
      needsSetup.value = status.needsSetup
    }
    catch {
      needsSetup.value = false
    }
  }

  if (needsSetup.value && !to.path.startsWith('/setup')) {
    return navigateTo('/setup')
  }

  if (!needsSetup.value && to.path.startsWith('/setup')) {
    return navigateTo('/')
  }
})
