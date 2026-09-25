import { describe, it, expect } from 'vitest'
import { parsePagination } from '../../server/utils/pagination'

describe('parsePagination', () => {
  it('defaults to page 1 and the default limit', () => {
    expect(parsePagination({})).toEqual({ page: 1, perPage: 50, limit: 50, offset: 0 })
    expect(parsePagination({}, 20)).toMatchObject({ limit: 20 })
  })

  it('computes the offset from page and limit', () => {
    expect(parsePagination({ page: '3', limit: '10' })).toEqual({ page: 3, perPage: 10, limit: 10, offset: 20 })
  })

  it('caps the limit at maxLimit and floors fractional values', () => {
    expect(parsePagination({ limit: '100000' })).toMatchObject({ limit: 500 })
    expect(parsePagination({ limit: '100' }, 10, 50)).toMatchObject({ limit: 50 })
    expect(parsePagination({ limit: '7.9', page: '2.5' })).toMatchObject({ limit: 7, page: 2, offset: 7 })
  })

  it.each(['abc', '', '-4', '0', 'NaN', 'Infinity'])('never yields a NaN/negative offset for page=%s', (page) => {
    const r = parsePagination({ page, limit: 'abc' })
    expect(r.page).toBeGreaterThanOrEqual(1)
    expect(Number.isFinite(r.offset)).toBe(true)
    expect(r.offset).toBeGreaterThanOrEqual(0)
    expect(r.limit).toBe(50)
  })
})
