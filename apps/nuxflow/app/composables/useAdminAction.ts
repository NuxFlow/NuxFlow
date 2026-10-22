export interface AdminActionOptions<T = unknown> {
  /**
   * Shown on success. A function gets the request's result, for messages that depend on
   * it; returning `undefined` shows no toast (e.g. when `fn` already showed a warning).
   * Omit for actions with their own custom success handling.
   */
  successTitle?: string | ((result: T) => string | undefined)
  /** What failed, e.g. "Couldn't delete theme". The server's reason goes underneath. */
  errorTitle: string
  /**
   * Names this run so `isRunning(key)` can tell it apart from others — for one spinner
   * per row (`key: theme.id`) or several buttons sharing one `useAdminAction()`.
   */
  key?: string
}

/**
 * The fetch/loading/toast shape every admin (and account) page action needs: mark it
 * running, run the request, toast on success or failure (the server's own error message
 * under a fixed title), clear the running state. Use this rather than a hand-written
 * try/catch/toast block, so every page reports errors the same way. One instance can serve
 * a whole component: `loading` is true while any run is in flight, `isRunning(key)` while
 * that keyed run is.
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
  // Count per key, not a Set: the same key can be run twice before the first finishes.
  const running = reactive(new Map<string, number>())
  const loading = computed(() => running.size > 0)

  function isRunning(key: string): boolean {
    return running.has(key)
  }

  async function run<T>(fn: () => Promise<T>, opts: AdminActionOptions<T>): Promise<T | undefined> {
    const key = opts.key ?? ''
    running.set(key, (running.get(key) ?? 0) + 1)
    try {
      const result = await fn()
      const title = typeof opts.successTitle === 'function' ? opts.successTitle(result) : opts.successTitle
      if (title) toast.add({ title, color: 'success' })
      return result
    } catch (e: unknown) {
      toast.add({ title: opts.errorTitle, description: getErrorMessage(e, ''), color: 'error' })
      return undefined
    } finally {
      const left = (running.get(key) ?? 1) - 1
      if (left > 0) running.set(key, left)
      else running.delete(key)
    }
  }

  return { loading, isRunning, run, toast }
}
