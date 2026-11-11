import { describe, it, expect } from 'vitest'
import { fieldDefsProblem, fieldKeyFrom, formatFieldValue, normalizeFieldValues, pageDetails, parseFieldDefs, type CustomFieldDef } from '../../shared/lib/custom-fields'

const defs: CustomFieldDef[] = [
  { key: 'price', label: 'Price', type: 'number', prefix: '£', required: true },
  { key: 'bedrooms', label: 'Bedrooms', type: 'number' },
  { key: 'size', label: 'Size', type: 'number', suffix: 'sq ft', showOnPage: false },
  { key: 'garden', label: 'Garden', type: 'boolean' },
  { key: 'kind', label: 'Kind', type: 'select', options: ['House', 'Flat'] },
  { key: 'amenities', label: 'Amenities', type: 'multiselect', options: ['Parking', 'EV charger'] },
  { key: 'available', label: 'Available from', type: 'date' },
  { key: 'tour', label: 'Virtual tour', type: 'url' },
]

describe('fieldKeyFrom', () => {
  it('makes a key from a name', () => {
    expect(fieldKeyFrom('Number of bedrooms')).toBe('number_of_bedrooms')
    expect(fieldKeyFrom('Café opens')).toBe('cafe_opens')
    expect(fieldKeyFrom('2nd phone')).toBe('f_2nd_phone')
    expect(fieldKeyFrom('!!')).toBe('field')
  })
})

describe('parseFieldDefs / fieldDefsProblem', () => {
  it('keeps good definitions and drops bad ones', () => {
    const parsed = parseFieldDefs({ fields: [
      { key: 'ok', label: 'OK', type: 'text' },
      { key: 'ok', label: 'Duplicate', type: 'text' },
      { key: 'Bad Key', label: 'x', type: 'text' },
      { key: 'odd', label: 'x', type: 'colour' },
      { key: 'pick', label: 'Pick', type: 'select', options: ['A', 'A', ' B ', ''] },
      { key: 'n', label: 'N', type: 'number', prefix: '£', suffix: 'each' },
      { key: 't', label: 'T', type: 'text', prefix: 'ignored' },
    ] })
    expect(parsed.map(d => d.key)).toEqual(['ok', 'pick', 'n', 't'])
    expect(parsed[1]!.options).toEqual(['A', 'B'])
    expect(parsed[2]).toMatchObject({ prefix: '£', suffix: 'each' })
    expect(parsed[3]).not.toHaveProperty('prefix')
    expect(parseFieldDefs(null)).toEqual([])
  })

  it('explains what\'s wrong with a list sent from the admin page', () => {
    expect(fieldDefsProblem([{ key: 'a', label: '', type: 'text' }])).toMatch(/needs a name/)
    expect(fieldDefsProblem([{ key: 'A b', label: 'X', type: 'text' }])).toMatch(/needs a key/)
    expect(fieldDefsProblem([{ key: 'a', label: 'X', type: 'text' }, { key: 'a', label: 'Y', type: 'text' }])).toMatch(/Two fields/)
    expect(fieldDefsProblem([{ key: 'a', label: 'X', type: 'select', options: [] }])).toMatch(/at least one choice/)
    expect(fieldDefsProblem(defs)).toBeNull()
  })
})

describe('normalizeFieldValues', () => {
  it('keeps numbers as numbers (commas allowed) and drops empty and unknown values', () => {
    expect(normalizeFieldValues(defs, { price: '250,000', bedrooms: 3, garden: false, kind: '', other: 'x' }))
      .toEqual({ price: 250000, bedrooms: 3, garden: false })
  })

  it('only accepts listed choices, real dates and web links', () => {
    expect(() => normalizeFieldValues(defs, { kind: 'Castle' })).toThrow(/Kind/)
    expect(() => normalizeFieldValues(defs, { amenities: ['Parking', 'Pool'] })).toThrow(/Amenities/)
    expect(() => normalizeFieldValues(defs, { available: '2027-02-30x' })).toThrow(/date/)
    expect(() => normalizeFieldValues(defs, { tour: 'javascript:alert(1)' })).toThrow(/https/)
    expect(() => normalizeFieldValues(defs, { price: 'lots' })).toThrow(/number/)
    expect(normalizeFieldValues(defs, { amenities: ['Parking', 'Parking'] })).toEqual({ amenities: ['Parking'] })
  })

  it('requires required fields only when asked to (on publishing)', () => {
    expect(normalizeFieldValues(defs, {})).toEqual({})
    expect(() => normalizeFieldValues(defs, {}, { requireAll: true })).toThrow(/Price/)
  })
})

describe('formatting for pages', () => {
  it('reads naturally', () => {
    expect(formatFieldValue(defs[0]!, 250000, 'en-GB')).toBe('£250,000')
    expect(formatFieldValue(defs[2]!, 1200, 'en-GB')).toBe('1,200 sq ft')
    expect(formatFieldValue(defs[3]!, true)).toBe('Yes')
    expect(formatFieldValue(defs[5]!, ['Parking', 'EV charger'])).toBe('Parking, EV charger')
    expect(formatFieldValue(defs[6]!, '2027-03-12', 'en-GB')).toBe('12 Mar 2027')
  })

  it('lists shown fields in the type\'s order, with links for links', () => {
    const details = pageDetails(defs, { tour: 'https://tour.test/1', size: 900, price: 100, garden: true }, 'en-GB')
    expect(details.map(d => [d.label, d.text])).toEqual([['Price', '£100'], ['Garden', 'Yes'], ['Virtual tour', 'https://tour.test/1']])
    expect(details[2]!.href).toBe('https://tour.test/1')
    expect(pageDetails(defs, null)).toEqual([])
  })
})
