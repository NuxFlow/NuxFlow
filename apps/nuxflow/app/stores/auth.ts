import { defineStore } from 'pinia'

export const useAuthStore = defineStore('auth', () => {
  const { user, loggedIn, signIn: _signIn, signOut: _signOut, fetchSession } = useUserSession()

  async function signIn(email: string, password: string) {
    const result = await _signIn.email({ email, password })
    if (result?.error) throw new Error(result.error.message ?? 'Sign in failed')
  }

  async function signOut() {
    await _signOut()
    await navigateTo('/login')
  }

  return { user, isAuthenticated: loggedIn, signIn, signOut, fetchUser: fetchSession }
})
