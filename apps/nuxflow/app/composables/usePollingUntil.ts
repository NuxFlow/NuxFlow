export interface PollingUntilOptions {
  /** Interval between checks, in ms. */
  intervalMs: number
  /**
   * Called on every tick, before `until()` is evaluated. Typically re-fetches
   * whatever state `until()` inspects (e.g. a list `refresh()`).
   */
  onTick: () => Promise<void> | void
  /**
   * Evaluated right after `onTick()` resolves on each tick. Returning `true`
   * stops polling and fires `onComplete`. A poller that should just keep
   * doing background work indefinitely (until manually `stop()`ped, e.g. on
   * unmount) rather than ever reaching a "done" state can pass `() => false`.
   */
  until: () => boolean
  /**
   * Optional overall timeout, in ms, measured from `start()`. If `until()`
   * hasn't returned `true` by the time this elapses, polling stops and
   * `onTimeout` fires instead of `onComplete`. Omit for a poller with no
   * natural end condition (see `until` above).
   */
  timeoutMs?: number
  /** Fired once, right after `until()` first returns `true`. */
  onComplete?: () => void | Promise<void>
  /** Fired once if `timeoutMs` elapses before `until()` returns `true`. */
  onTimeout?: () => void
}

/**
 * Generic "poll on an interval, check a predicate, stop on success/timeout"
 * state machine — extracted from two independent copies of this exact shape:
 * the bulk alt-text background-job poller (media/index.vue) and the
 * video-processing-status poller (media/videos.vue). The former has a real
 * completion predicate and a timeout; the latter has neither (it just does
 * conditional background sync work for as long as the page is mounted) — both
 * are expressible here, the latter via `until: () => false` and no `timeoutMs`.
 *
 * `start()` clears any previously running interval first, so it's always
 * safe to call again (e.g. to restart with a fresh timeout window). `stop()`
 * is also registered automatically on `onBeforeUnmount` so callers don't need
 * their own cleanup hook.
 */
export function usePollingUntil(options: PollingUntilOptions) {
  const pending = ref(false)
  let handle: ReturnType<typeof setInterval> | null = null
  let startedAt = 0

  function stop() {
    if (handle) {
      clearInterval(handle)
      handle = null
    }
    pending.value = false
  }

  function start() {
    stop()
    pending.value = true
    startedAt = Date.now()

    handle = setInterval(async () => {
      await options.onTick()

      if (options.until()) {
        stop()
        await options.onComplete?.()
        return
      }

      if (options.timeoutMs !== undefined && Date.now() - startedAt > options.timeoutMs) {
        stop()
        options.onTimeout?.()
      }
    }, options.intervalMs)
  }

  onBeforeUnmount(stop)

  return { start, stop, pending }
}
