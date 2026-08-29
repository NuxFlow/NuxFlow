export interface SessionUser {
  id: string
  name: string
  email: string
  emailVerified: boolean
  image?: string | null
}

// The single raw, settable source of truth — seeded by
// app/middleware/session.global.ts. useUserSession() below exposes a read-only
// view of it; useSignIn()/signOut() write to it directly so a client-side
// navigateTo() afterward reflects the change immediately, without waiting for
// (or relying on) a fresh SSR render re-running the middleware's fetch branch.
function useSessionUserState() {
  return useState<SessionUser | null | undefined>('auth:user', () => undefined)
}

export function useAuthClient() {
  return useNuxtApp().$authClient
}

export function useUserSession() {
  const user = useSessionUserState()
  const loggedIn = computed(() => !!user.value)

  async function fetchSession() {
    const res = await $fetch<{ user: SessionUser | null }>('/api/v1/auth/session')
    user.value = res.user
  }

  async function signOut() {
    await useAuthClient().signOut()
    user.value = null
  }

  return {
    user: computed(() => user.value ?? null),
    loggedIn,
    signOut,
    fetchSession,
  }
}

// type: 'social' triggers a full browser redirect and never resolves normally —
// callers that use it never check .error afterward, matching that behavior.
export function useSignIn(type: 'email' | 'social' | 'passkey') {
  const client = useAuthClient()
  const error = ref<{ message?: string } | undefined>()

  async function execute(args?: Record<string, unknown>) {
    error.value = undefined
    // Each sign-in method's response shape differs (social redirects with no
    // `user`; email/passkey return one on success) — narrow at the point of
    // use rather than forcing all three into one manufactured result type.
    const res = type === 'email'
      ? await client.signIn.email(args as Parameters<typeof client.signIn.email>[0])
      : type === 'social'
        ? await client.signIn.social(args as Parameters<typeof client.signIn.social>[0])
        : await client.signIn.passkey(args as Parameters<typeof client.signIn.passkey>[0])

    if (res.error) {
      error.value = res.error
      return
    }
    const data = res.data as { user?: SessionUser } | null | undefined
    if (data?.user) {
      useSessionUserState().value = data.user
    }
  }

  return { execute, error }
}
