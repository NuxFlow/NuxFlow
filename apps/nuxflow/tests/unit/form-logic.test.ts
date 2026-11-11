import { describe, it, expect } from 'vitest'
import { describeShowIf, formSteps, hiddenFieldNames, isFieldShown, parseShowIf, type LogicField } from '../../shared/lib/form-logic'

const fields: LogicField[] = [
  { name: 'service', type: 'select', label: 'Service' },
  { name: 'boilerMake', type: 'text', label: 'Boiler make', showIf: { field: 'service', op: 'equals', value: 'Boiler repair' } },
  { name: 'boilerAge', type: 'number', label: 'Boiler age', showIf: { field: 'boilerMake', op: 'filled' } },
  { name: 'extras', type: 'checkbox', label: 'Extras' },
  { name: 'gate', type: 'text', showIf: { field: 'extras', op: 'equals', value: 'gate code' } },
]

describe('isFieldShown', () => {
  it('compares ignoring case and spaces', () => {
    expect(isFieldShown(fields[1]!, { service: ' boiler REPAIR ' }, fields)).toBe(true)
    expect(isFieldShown(fields[1]!, { service: 'Plumbing' }, fields)).toBe(false)
  })

  it('hides a field whose condition depends on a hidden field', () => {
    // boilerMake still has an answer from before the visitor changed their mind.
    expect(isFieldShown(fields[2]!, { service: 'Plumbing', boilerMake: 'Worcester' }, fields)).toBe(false)
    expect(isFieldShown(fields[2]!, { service: 'Boiler repair', boilerMake: 'Worcester' }, fields)).toBe(true)
  })

  it('treats a ticked checkbox option as "is"', () => {
    expect(isFieldShown(fields[4]!, { extras: ['Parking', 'Gate code'] }, fields)).toBe(true)
    expect(isFieldShown(fields[4]!, { extras: [] }, fields)).toBe(false)
  })

  it('supports is not, contains, and empty', () => {
    const f = (op: string, value?: string): LogicField => ({ name: 'x', type: 'text', showIf: { field: 'service', op: op as never, value } })
    expect(isFieldShown(f('not_equals', 'Plumbing'), { service: 'Boiler repair' }, fields)).toBe(true)
    expect(isFieldShown(f('contains', 'boiler'), { service: 'Boiler repair' }, fields)).toBe(true)
    expect(isFieldShown(f('empty'), { service: '' }, fields)).toBe(true)
    expect(isFieldShown(f('empty'), { service: 'x' }, fields)).toBe(false)
  })

  it('shows a field whose condition names a field that no longer exists, and survives loops', () => {
    expect(isFieldShown({ name: 'a', type: 'text', showIf: { field: 'gone', op: 'filled' } }, {}, fields)).toBe(true)
    const loop: LogicField[] = [
      { name: 'a', type: 'text', showIf: { field: 'b', op: 'empty' } },
      { name: 'b', type: 'text', showIf: { field: 'a', op: 'empty' } },
    ]
    expect(() => isFieldShown(loop[0]!, {}, loop)).not.toThrow()
  })

  it('lists the hidden fields', () => {
    expect([...hiddenFieldNames(fields, { service: 'Plumbing', extras: [] })]).toEqual(['boilerMake', 'boilerAge', 'gate'])
  })
})

describe('formSteps', () => {
  it('splits at step fields and drops empty steps', () => {
    const steps = formSteps([
      { name: 'a', type: 'text' },
      { name: 's1', type: 'step', label: 'Replaced by the next break' },
      { name: 's2', type: 'step', label: 'Your property' },
      { name: 'b', type: 'text' },
      { name: 's3', type: 'step', label: 'Trailing' },
    ])
    expect(steps.map(s => [s.title, s.fields.map(f => f.name)])).toEqual([['', ['a']], ['Your property', ['b']]])
  })

  it('is one step without any breaks', () => {
    expect(formSteps(fields)).toHaveLength(1)
  })
})

describe('parseShowIf / describeShowIf', () => {
  it('keeps only a well-formed condition', () => {
    expect(parseShowIf({ field: 'service', op: 'equals', value: 'x' })).toEqual({ field: 'service', op: 'equals', value: 'x' })
    expect(parseShowIf({ field: 'service', op: 'matches regex' })).toBeNull()
    expect(parseShowIf({ op: 'filled' })).toBeNull()
    expect(parseShowIf('x')).toBeNull()
  })

  it('reads plainly in the builder', () => {
    expect(describeShowIf({ field: 'service', op: 'equals', value: 'Boiler repair' }, fields)).toBe('Shown when Service is "Boiler repair"')
    expect(describeShowIf({ field: 'boilerMake', op: 'filled' }, fields)).toBe('Shown when Boiler make is filled in')
  })
})
