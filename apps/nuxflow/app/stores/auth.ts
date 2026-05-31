import { defineStore } from 'pinia'

export const useAuthStore = defineStore('auth', () => {
  const { user, loggedIn, signOut: _signOut, fetchSession } = useUserSession()
  const signInEmail = useSignIn('email')

  async function signIn(email: string, password: string) {
    await signInEmail.execute({ email, password })
    if (signInEmail.error.value) {
      throw new Error(signInEmail.error.value.message ?? 'Sign in failed')
    }
  }

  async function signOut() {
    await _signOut()
    await navigateTo('/login')
  }

  return { user, isAuthenticated: loggedIn, signIn, signOut, fetchUser: fetchSession }
})
