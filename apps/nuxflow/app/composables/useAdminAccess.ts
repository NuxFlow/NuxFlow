import type { Role } from '~/utils/admin-nav'

export interface AdminAccess {
  role: Role | null
  isSuperAdmin: boolean
}

// Same useState null-sentinel pattern as 01.session.global.ts's auth:user — fetched once
// per app lifetime (SSR render or first client boot) and shared between AdminSidebar.vue
// (nav filtering) and 02.admin-role-guard.global.ts (route gating) so navigating around
// the admin doesn't refetch /api/v1/users/me on every single page.
export function useAdminAccessState() {
  return useState<AdminAccess | null | undefined>('admin:access', () => undefined)
}

export async function fetchAdminAccess(): Promise<AdminAccess | null> {
  const state = useAdminAccessState()
  if (state.value !== undefined) return state.value ?? null

  // Sidebar.vue and 02.admin-role-guard.global.ts can both call this concurrently on
  // first admin navigation, both seeing state.value === undefined before either $fetch
  // resolves — cache the in-flight PROMISE (not just the eventual value) so they share
  // one request instead of firing two. Stashed on the current nuxtApp instance rather
  // than a plain module-level variable: Nuxt creates a fresh nuxtApp per SSR request (a
  // module-level variable would leak between concurrent requests sharing the same
  // server process/isolate), and rather than useState(), since useState's value gets
  // serialized into the SSR payload and a Promise isn't serializable.
  const nuxtApp = useNuxtApp() as ReturnType<typeof useNuxtApp> & { _adminAccessPromise?: Promise<AdminAccess | null> }
  if (!nuxtApp._adminAccessPromise) {
    nuxtApp._adminAccessPromise = (async () => {
      try {
        state.value = await $fetch<AdminAccess>('/api/v1/users/me', {
          headers: import.meta.server ? useRequestHeaders(['cookie', 'host']) : undefined,
        })
      } catch {
        state.value = null
      } finally {
        nuxtApp._adminAccessPromise = undefined
      }
      return state.value ?? null
    })()
  }
  return nuxtApp._adminAccessPromise
}
