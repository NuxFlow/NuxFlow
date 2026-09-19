export interface AdminActionOptions {
  /** Shown on success. Omit for actions with their own custom success handling (e.g. one that needs to set extra local state before/after the toast). */
  successTitle?: string
  errorTitle: string
}

/**
 * The fetch/loading/toast shape repeated across nearly every admin page action
 * (save buttons, test-send buttons, generate/regenerate buttons, delete confirmations):
 * set loading, run the request, toast on success or failure (preferring the server's
 * own error message when present), clear loading. Extracted after a pre-release audit
 * found this exact block duplicated across 12+ admin pages with inconsistent error
 * message phrasing between copies.
 */
export function useAdminAction() {
  const toast = useToast()
  const loading = ref(false)

  async function run<T>(fn: () => Promise<T>, opts: AdminActionOptions): Promise<T | undefined> {
    loading.value = true
    try {
      const result = await fn()
      if (opts.successTitle) toast.add({ title: opts.successTitle, color: 'success' })
      return result
    } catch (e: unknown) {
      const message = (e as { data?: { message?: string } })?.data?.message
      toast.add({ title: opts.errorTitle, description: message, color: 'error' })
      return undefined
    } finally {
      loading.value = false
    }
  }

  return { loading, run, toast }
}
