export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path.startsWith('/setup') || to.path.startsWith('/api')) return

  const needsSetup = useState('setup:needs-setup', () => null as boolean | null)
  if (needsSetup.value === null) {
    try {
      const status = await $fetch<{ needsSetup: boolean }>('/api/v1/setup/status')
      needsSetup.value = status.needsSetup
    }
    catch {
      needsSetup.value = false
    }
  }

  if (needsSetup.value) {
    return navigateTo('/setup')
  }
})
