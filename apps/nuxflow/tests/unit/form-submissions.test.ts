import { describe, it, expect } from 'vitest'
import {
  displayValue,
  replyAddress,
  sanitizeCsvCell,
  submissionColumns,
  submissionFiles,
  submissionPreview,
  submissionsToCsv,
  type InboxSubmission,
} from '../../app/utils/form-submissions'
import { formatFileSize, formFileContentType, formFileProblem } from '../../shared/lib/form-files'

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

describe('uploaded files', () => {
  const file = { kind: 'file' as const, name: 'boiler.jpg', size: 2048, type: 'image/jpeg', key: '_private/s/forms/f/sub/x-boiler.jpg' }

  it('shows file names, not the stored object, in previews and the CSV', () => {
    expect(displayValue([file, { ...file, name: 'tank.pdf' }])).toBe('boiler.jpg, tank.pdf')
  })

  it('links each file to the staff-only download route', () => {
    const [link] = submissionFiles('01SUB', 'your photos', [file])
    expect(link.url).toBe('/_nuxflow/form-file/01SUB?field=your%20photos&n=0')
  })

  it('treats ordinary values as having no files', () => {
    expect(submissionFiles('01SUB', 'name', 'Sam')).toEqual([])
    expect(submissionFiles('01SUB', 'tags', ['a', 'b'])).toEqual([])
  })
})

describe('form file rules', () => {
  it('takes photos, PDFs and documents by extension', () => {
    expect(formFileProblem({ name: 'IMG_0001.HEIC', size: 10 })).toBeNull()
    expect(formFileProblem({ name: 'quote.pdf', size: 10 })).toBeNull()
    expect(formFileContentType('plan.docx')).toContain('wordprocessingml')
  })

  it('refuses anything a browser would run, empty files and files over 10 MB', () => {
    for (const name of ['x.svg', 'x.html', 'x.htm', 'x.js', 'x.exe', 'x']) expect(formFileProblem({ name, size: 10 })).not.toBeNull()
    expect(formFileProblem({ name: 'a.jpg', size: 0 })).not.toBeNull()
    expect(formFileProblem({ name: 'a.jpg', size: 10 * 1024 * 1024 + 1 })).not.toBeNull()
  })

  it('formats sizes for people', () => {
    expect(formatFileSize(500)).toBe('500 B')
    expect(formatFileSize(2048)).toBe('2 KB')
    expect(formatFileSize(3.5 * 1024 * 1024)).toBe('3.5 MB')
  })
})
