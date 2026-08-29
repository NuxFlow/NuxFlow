import type { SessionUser } from '~/composables/useAuth'

// Seeds the reactive auth:user state exactly once per app lifetime (SSR render,
// or first client boot) via the useState null-sentinel pattern already used by
// setup-guard.global.ts in this same directory. Runs before page-scoped
// middleware (app/middleware/auth.ts), so loggedIn.value there never observes
// the `undefined` sentinel.
export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path.startsWith('/api')) return

  const user = useState<SessionUser | null | undefined>('auth:user', () => undefined)
  if (user.value === undefined) {
    try {
      // 'cookie' is required here — unlike setup-guard.global.ts's fetch (which
      // doesn't need the session cookie), omitting it would make every SSR
      // render silently resolve as logged-out while still looking correct via
      // client-side navigation alone.
      const res = await $fetch<{ user: SessionUser | null }>('/api/v1/auth/session', {
        headers: useRequestHeaders(['cookie', 'host']),
      })
      user.value = res.user
    } catch {
      user.value = null
    }
  }

  // Previously provided by @onmax/nuxt-better-auth's `auth.redirects.guest`
  // config: bounce an already-authenticated visitor away from the sign-in/
  // sign-up pages. Deliberately scoped to just these two — /setup and
  // /reset-password/forgot-password have legitimate authenticated use cases
  // (secondary-site setup, changing a password while signed in).
  if (user.value && (to.path === '/login' || to.path === '/register')) {
    return navigateTo('/admin')
  }
})
