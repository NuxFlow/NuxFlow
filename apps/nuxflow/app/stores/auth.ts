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

  // Clears the session without the default redirect to /login — for callers
  // that need to navigate somewhere else afterward (e.g. to /setup after a
  // site deletion resets the current domain back to a fresh install).
  async function signOutSilently() {
    await _signOut()
  }

  return { user, isAuthenticated: loggedIn, signIn, signOut, signOutSilently, fetchUser: fetchSession }
})
