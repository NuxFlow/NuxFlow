import { describe, it, expect, vi } from 'vitest'

vi.mock('../../server/utils/db', () => ({ useDb: () => { throw new Error('no db in unit tests') } }))

const { AI_CREDITS, textCredits, speechCredits } = await import('../../server/utils/ai-allowance')

describe('AI credits', () => {
  it('charges 1 credit per 1,000 tokens on the fast model, rounded up', () => {
    expect(textCredits(1000, false)).toBe(1)
    expect(textCredits(1001, false)).toBe(2)
    expect(textCredits(9500, false)).toBe(10)
  })

  it('weights the heavy model', () => {
    expect(textCredits(1000, true)).toBe(AI_CREDITS.heavyModelMultiplier)
    expect(textCredits(2000, true)).toBe(2 * AI_CREDITS.heavyModelMultiplier)
  })

  it('charges at least 1 credit, even when the provider reports no usage', () => {
    expect(textCredits(0, true)).toBe(1)
    expect(textCredits(undefined, false)).toBe(1)
    expect(textCredits(Number.NaN, false)).toBe(1)
  })

  it('charges speech by length', () => {
    expect(speechCredits(10)).toBe(1)
    expect(speechCredits(3000)).toBe(3)
  })
})
