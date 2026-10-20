import { describe, it, expect } from 'vitest'
import {
  displayValue,
  replyAddress,
  sanitizeCsvCell,
  submissionColumns,
  submissionPreview,
  submissionsToCsv,
  type InboxSubmission,
} from '../../app/utils/form-submissions'

const sub = (data: Record<string, unknown>, status: InboxSubmission['status'] = 'new'): InboxSubmission =>
  ({ id: 's1', createdAt: '2026-10-20T10:00:00.000Z', status, data })

describe('submissionColumns', () => {
  it('uses the form fields in order with their labels, then extra keys from the data', () => {
    const fields = [
      { name: 'date', label: 'Wedding date', type: 'date' },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'ref', label: 'Ref', type: 'hidden' },
    ]
    expect(submissionColumns(fields, [sub({ email: 'a@b.co', date: '2027-06-01', oldField: 'x' })])).toEqual([
      { key: 'date', label: 'Wedding date' },
      { key: 'email', label: 'Email' },
      { key: 'oldField', label: 'oldField' },
    ])
  })

  it('falls back to a field\'s id when it has no name (contact form from older bundles)', () => {
    expect(submissionColumns([{ id: 'message', label: 'Message' }], [])).toEqual([{ key: 'message', label: 'Message' }])
  })
})

describe('replyAddress', () => {
  it('prefers an email-type field, then a key called email', () => {
    expect(replyAddress([{ name: 'contact', type: 'email' }], sub({ contact: 'x@y.co', email: 'z@y.co' }))).toBe('x@y.co')
    expect(replyAddress([], sub({ email: ' z@y.co ' }))).toBe('z@y.co')
  })

  it('ignores values that are not a plain address', () => {
    expect(replyAddress([], sub({ email: 'not an email' }))).toBeNull()
    expect(replyAddress([], sub({ email: 'a@b.co?bcc=evil@x.co' }))).toBeNull()
    expect(replyAddress([], sub({ email: 'a@b.co,other@x.co' }))).toBeNull()
    expect(replyAddress([], sub({}))).toBeNull()
  })
})

describe('displayValue / submissionPreview', () => {
  it('formats arrays, booleans and empties', () => {
    expect(displayValue(['a', 'b'])).toBe('a, b')
    expect(displayValue(true)).toBe('Yes')
    expect(displayValue(null)).toBe('')
  })

  it('previews the first values', () => {
    const cols = [{ key: 'name', label: 'Name' }, { key: 'email', label: 'Email' }, { key: 'message', label: 'Message' }, { key: 'x', label: 'X' }]
    expect(submissionPreview(cols, sub({ name: 'Ann', email: 'a@b.co', message: 'Hi', x: 'later' }))).toEqual({ title: 'Ann', detail: 'a@b.co · Hi' })
    expect(submissionPreview(cols, sub({})).title).toBe('(empty submission)')
  })
})

describe('CSV export', () => {
  it('neutralizes spreadsheet formulas', () => {
    expect(sanitizeCsvCell('=HYPERLINK("x")')).toBe(JSON.stringify('\'=HYPERLINK("x")'))
    expect(sanitizeCsvCell('plain')).toBe('"plain"')
  })

  it('writes labelled headers, status and every column', () => {
    const csv = submissionsToCsv([{ key: 'name', label: 'Name' }], [sub({ name: 'Ann' }, 'read')])
    expect(csv).toBe('"Submitted at","Status","Name"\n"2026-10-20T10:00:00.000Z","read","Ann"')
  })
})
