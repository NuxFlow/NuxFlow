import { describe, it, expect, vi, beforeEach } from 'vitest'
import { reactive, computed } from 'vue'
import { getErrorMessage } from '../../app/utils/errors'

// useAdminAction.ts relies on Nuxt auto-imports. This is a plain vitest unit test (node
// environment, no Nuxt runtime), so provide them as globals before importing it.
const toastAdd = vi.fn()
vi.stubGlobal('reactive', reactive)
vi.stubGlobal('computed', computed)
vi.stubGlobal('getErrorMessage', getErrorMessage)
vi.stubGlobal('useToast', () => ({ add: toastAdd }))

const { useAdminAction } = await import('../../app/composables/useAdminAction')

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

beforeEach(() => toastAdd.mockClear())

describe('useAdminAction', () => {
  it('returns the result and shows the success toast', async () => {
    const { run } = useAdminAction()
    const result = await run(async () => 42, { successTitle: 'Saved', errorTitle: "Couldn't save" })
    expect(result).toBe(42)
    expect(toastAdd).toHaveBeenCalledWith({ title: 'Saved', color: 'success' })
  })

  it('builds the success title from the result, and skips it when the function returns undefined', async () => {
    const { run } = useAdminAction()
    await run(async () => ({ n: 3 }), { successTitle: r => `${r.n} deleted`, errorTitle: 'x' })
    expect(toastAdd).toHaveBeenLastCalledWith({ title: '3 deleted', color: 'success' })
    toastAdd.mockClear()
    await run(async () => ({ n: 0 }), { successTitle: r => (r.n ? 'done' : undefined), errorTitle: 'x' })
    expect(toastAdd).not.toHaveBeenCalled()
  })

  it('on failure shows the fixed title with the server message underneath and returns undefined', async () => {
    const { run } = useAdminAction()
    const result = await run(async () => {
      throw Object.assign(new Error('fetch failed'), { data: { message: 'Slug already taken' } })
    }, { successTitle: 'Saved', errorTitle: "Couldn't save" })
    expect(result).toBeUndefined()
    expect(toastAdd).toHaveBeenCalledTimes(1)
    expect(toastAdd).toHaveBeenCalledWith({ title: "Couldn't save", description: 'Slug already taken', color: 'error' })
  })

  it('tracks loading and keyed runs separately', async () => {
    const { run, loading, isRunning } = useAdminAction()
    const a = deferred<undefined>()
    const b = deferred<undefined>()
    const runA = run(() => a.promise, { errorTitle: 'x', key: 'a' })
    const runB = run(() => b.promise, { errorTitle: 'x', key: 'b' })
    expect(loading.value).toBe(true)
    expect(isRunning('a')).toBe(true)
    expect(isRunning('b')).toBe(true)

    a.resolve(undefined)
    await runA
    expect(isRunning('a')).toBe(false)
    expect(loading.value).toBe(true)

    b.reject(new Error('boom'))
    await runB
    expect(isRunning('b')).toBe(false)
    expect(loading.value).toBe(false)
  })

  it('keeps a key running until every overlapping run of it has finished', async () => {
    const { run, isRunning } = useAdminAction()
    const first = deferred<undefined>()
    const second = deferred<undefined>()
    const p1 = run(() => first.promise, { errorTitle: 'x', key: 'k' })
    const p2 = run(() => second.promise, { errorTitle: 'x', key: 'k' })
    first.resolve(undefined)
    await p1
    expect(isRunning('k')).toBe(true)
    second.resolve(undefined)
    await p2
    expect(isRunning('k')).toBe(false)
  })
})
