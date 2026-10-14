// Turnstile on the password sign-in and forgot-password forms, when the operator has turned
// it on (server/utils/sign-in-captcha.ts). The token travels in the `x-captcha-response`
// header Better Auth's captcha plugin reads, and is single-use: reset() after every
// attempt so the next one gets a fresh token.
export async function useSignInCaptcha() {
  const { data } = await useFetch<{ siteKey: string | null }>('/api/v1/auth/captcha', {
    key: 'sign-in-captcha',
    headers: useRequestHeaders(['host']),
  })
  const siteKey = computed(() => data.value?.siteKey ?? null)
  const token = ref('')
  const widget = ref<{ reset: () => void } | null>(null)

  /** Whether the form can be submitted — always, unless a token is still being issued. */
  const ready = computed(() => !siteKey.value || Boolean(token.value))

  function fetchOptions(): { headers: Record<string, string> } | undefined {
    return siteKey.value ? { headers: { 'x-captcha-response': token.value } } : undefined
  }

  function reset() {
    token.value = ''
    widget.value?.reset()
  }

  return { siteKey, token, widget, ready, fetchOptions, reset }
}
