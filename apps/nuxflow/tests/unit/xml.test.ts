import { describe, it, expect } from 'vitest'
import { escXml, cdataSafe } from '../../server/utils/xml'

describe('escXml', () => {
  it('escapes all 5 XML metacharacters', () => {
    expect(escXml(`<tag> & "quoted" 'apos'`)).toBe('&lt;tag&gt; &amp; &quot;quoted&quot; &apos;apos&apos;')
  })

  it('leaves plain text untouched', () => {
    expect(escXml('Hello, World! 123')).toBe('Hello, World! 123')
  })
})

describe('cdataSafe', () => {
  it('splits a literal "]]>" into adjacent CDATA sections instead of a bare terminator', () => {
    const title = 'My Post ]]> <script>alert(1)</script>'
    const escaped = cdataSafe(title)

    // Per XML spec, adjacent CDATA sections concatenate as if they were one — so
    // reversing the split (folding "]]]]><![CDATA[" back into a plain "]]>") must
    // losslessly reconstruct the original text. This is what actually matters: not
    // whether the raw substring "]]>" appears (the fix's own reopen sequence
    // necessarily contains it), but whether a real XML parser reading
    // `<title><![CDATA[${escaped}]]></title>` ends up with the original, complete title
    // as its text content instead of truncating at the first old-style bare "]]>".
    expect(escaped.replace(/\]\]\]\]><!\[CDATA\[/g, ']]')).toBe(title)

    // The literal terminator must never appear as a BARE, un-reopened sequence — every
    // occurrence has to be immediately followed by a fresh CDATA opener (or be the
    // final, real closing one added by the caller, which cdataSafe's own output never
    // includes).
    for (const idx of allIndicesOf(escaped, ']]>')) {
      expect(escaped.startsWith('<![CDATA[', idx + ']]>'.length)).toBe(true)
    }
  })

  it('leaves text with no "]]>" sequence untouched', () => {
    expect(cdataSafe('A perfectly normal title')).toBe('A perfectly normal title')
  })
})

function allIndicesOf(haystack: string, needle: string): number[] {
  const indices: number[] = []
  let i = haystack.indexOf(needle)
  while (i !== -1) {
    indices.push(i)
    i = haystack.indexOf(needle, i + 1)
  }
  return indices
}
