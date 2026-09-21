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
 *
 * IMPORTANT — always give `$fetch` an explicit response-type generic inside the `fn`
 * callback passed to `run()`, e.g. `run(() => $fetch<{ id: string }>('/api/...'), ...)`,
 * even when the response is unused (`$fetch<unknown>(...)`). `run<T>`'s own generic has to
 * be inferred from `fn`'s return type, which — if `$fetch` has no explicit generic of its
 * own — forces TypeScript to fully resolve `$fetch`'s return type by matching the literal
 * URL against every one of this app's ~300 registered Nitro routes (see
 * `.nuxt/types/nitro-routes.d.ts`'s `InternalApi`). That match is expensive enough to hit
 * TypeScript's recursion limit outright ("Excessive stack depth comparing types" on the
 * `$fetch` call site), independent of literally anything else in the codebase — this is a
 * confirmed, reproducible TypeScript/Nitro interaction (see the write-up in CLAUDE.md's
 * "Nuxt config notes" section for the full investigation), not a one-off fluke. An
 * explicit generic gives `T` directly and skips that resolution entirely.
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
      toast.add({ title: opts.errorTitle, description: getErrorMessage(e, ''), color: 'error' })
      return undefined
    } finally {
      loading.value = false
    }
  }

  return { loading, run, toast }
}
