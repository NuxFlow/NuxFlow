import { describe, expect, it } from 'vitest'
import { argon2Hash, argon2Verify, MAX_CONCURRENT_HASHES, withHashSlot } from '../../server/utils/argon2'

describe('argon2 hashing', () => {
  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await argon2Hash('correct horse battery staple')
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/)
    expect(await argon2Verify(hash, 'correct horse battery staple')).toBe(true)
    expect(await argon2Verify(hash, 'wrong')).toBe(false)
  }, 30_000)
})

describe('withHashSlot', () => {
  it(`never runs more than ${MAX_CONCURRENT_HASHES} at once, and runs every one`, async () => {
    let active = 0
    let peak = 0
    const done: number[] = []
    const job = (i: number) => withHashSlot(async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, 5))
      active--
      done.push(i)
      return i
    })

    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => job(i)))
    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(peak).toBe(MAX_CONCURRENT_HASHES)
    expect(done).toHaveLength(8)
  })

  it('frees its slot when the work throws', async () => {
    await expect(withHashSlot(async () => { throw new Error('boom') })).rejects.toThrow('boom')
    // If the failed call had kept its slot, these would wait forever.
    const results = await Promise.all([1, 2, 3].map(n => withHashSlot(async () => n)))
    expect(results).toEqual([1, 2, 3])
  })
})
