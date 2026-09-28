export default defineNuxtRouteMiddleware(async (to) => {
  const { loggedIn } = useUserSession()

  if (!loggedIn.value) {
    // On a site's own domain under central sign-in this leaves the SPA for the handoff
    // route (a server redirect to the accounts origin) — never a local /login page.
    const { signInUrl, onSiteDomain } = useAccounts()
    return navigateTo(signInUrl(to.fullPath), { external: onSiteDomain })
  }
})
