import { describe, it, expect } from 'vitest'
import { htmlToTipTap, decodeHtmlEntities, stripHtmlToPlainText } from '../../server/utils/html-to-tiptap'
import { renderTipTap } from '../../shared/lib/render-tiptap'

// Round-trips HTML through the importer's parser and the app's own TipTap-to-HTML
// renderer — the two are meant to be exact inverses, so this is the strongest possible
// check that imported WordPress content will actually display as intended.
function roundTrip(html: string): string {
  return renderTipTap(htmlToTipTap(html))
}

describe('htmlToTipTap', () => {
  it('parses a simple paragraph as a real paragraph node, not literal text', () => {
    const doc = htmlToTipTap('<p>Hello world</p>')
    expect(doc).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] }],
    })
  })

  it('round-trips a paragraph back to the same HTML', () => {
    expect(roundTrip('<p>Hello world</p>')).toBe('<p>Hello world</p>')
  })

  it('converts bold/italic/link tags into TipTap marks, not raw tags', () => {
    const html = '<p>Some <strong>bold</strong> and <em>italic</em> and a <a href="https://example.com">link</a>.</p>'
    expect(roundTrip(html)).toBe(
      '<p>Some <strong>bold</strong> and <em>italic</em> and a <a href="https://example.com">link</a>.</p>',
    )
  })

  it('supports <b>/<i> as aliases for bold/italic', () => {
    expect(roundTrip('<p><b>bold</b> <i>italic</i></p>')).toBe('<p><strong>bold</strong> <em>italic</em></p>')
  })

  it('handles nested marks (bold inside a link)', () => {
    const doc = htmlToTipTap('<p><a href="https://x.com"><strong>bold link</strong></a></p>')
    const textNode = doc.content[0]!.content![0]!
    expect(textNode.marks?.map(m => m.type).sort()).toEqual(['bold', 'link'])
  })

  it('converts headings to heading nodes with inline-only content', () => {
    const doc = htmlToTipTap('<h2>My <strong>Title</strong></h2>')
    expect(doc.content[0]).toEqual({
      type: 'heading',
      attrs: { level: 2 },
      content: [
        { type: 'text', text: 'My ' },
        { type: 'text', text: 'Title', marks: [{ type: 'bold' }] },
      ],
    })
  })

  it('converts <img> into a block image node with src/alt', () => {
    const doc = htmlToTipTap('<p><img src="https://example.com/photo.jpg" alt="A photo" width="600" height="400"></p>')
    expect(doc.content[0]).toEqual({
      type: 'image',
      attrs: { src: 'https://example.com/photo.jpg', alt: 'A photo', width: 600, height: 400 },
    })
  })

  it('converts unordered and ordered lists', () => {
    expect(roundTrip('<ul><li>One</li><li>Two</li></ul>')).toBe('<ul><li><p>One</p></li><li><p>Two</p></li></ul>')
    expect(roundTrip('<ol><li>One</li><li>Two</li></ol>')).toBe('<ol><li><p>One</p></li><li><p>Two</p></li></ol>')
  })

  it('converts blockquotes, including nested paragraphs', () => {
    expect(roundTrip('<blockquote><p>Quoted</p></blockquote>')).toBe('<blockquote><p>Quoted</p></blockquote>')
  })

  it('converts <pre><code> into a codeBlock, preserving language class', () => {
    const doc = htmlToTipTap('<pre><code class="language-js">const x = 1;</code></pre>')
    expect(doc.content[0]).toEqual({
      type: 'codeBlock',
      attrs: { language: 'js' },
      content: [{ type: 'text', text: 'const x = 1;' }],
    })
  })

  it('converts <hr> to a horizontalRule', () => {
    expect(roundTrip('<p>A</p><hr><p>B</p>')).toBe('<p>A</p><hr><p>B</p>')
  })

  it('converts <br> to a hardBreak inside a paragraph', () => {
    expect(roundTrip('<p>Line one<br>Line two</p>')).toBe('<p>Line one<br>Line two</p>')
  })

  it('converts a simple table (cells hold block content, matching TipTap\'s table schema)', () => {
    const html = '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>'
    expect(roundTrip(html)).toBe(
      '<table><tbody><tr><th><p>A</p></th><th><p>B</p></th></tr><tr><td><p>1</p></td><td><p>2</p></td></tr></tbody></table>',
    )
  })

  it('decodes WordPress-style HTML entities into real characters', () => {
    const doc = htmlToTipTap('<p>It&#8217;s a &ldquo;test&rdquo; &amp; more&hellip;</p>')
    expect(doc.content[0]!.content![0]!.text).toBe('It’s a “test” & more…')
  })

  it('does not double-escape when rendered back to HTML (entities decoded then re-escaped once)', () => {
    expect(roundTrip('<p>Ben &amp; Jerry&#8217;s</p>')).toBe('<p>Ben &amp; Jerry’s</p>')
  })

  it('drops unknown wrapper tags (div/span) but keeps their content', () => {
    expect(roundTrip('<div><span>Wrapped text</span></div>')).toBe('<p>Wrapped text</p>')
  })

  it('leaves WordPress shortcodes as literal text (no generic way to interpret them)', () => {
    // The renderer's esc() escapes quotes in text nodes too — valid, harmless HTML that
    // still displays as a literal double-quote — so the shortcode text survives intact.
    expect(roundTrip('<p>[gallery ids="1,2,3"]</p>')).toBe('<p>[gallery ids=&quot;1,2,3&quot;]</p>')
  })

  it('ignores HTML comments (Gutenberg block markers)', () => {
    expect(roundTrip('<!-- wp:paragraph --><p>Hello</p><!-- /wp:paragraph -->')).toBe('<p>Hello</p>')
  })

  it('returns a single empty paragraph for empty input', () => {
    expect(htmlToTipTap('')).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] })
    expect(htmlToTipTap('   ')).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] })
  })

  it('is not fooled by a crafted __proto__ attribute name', () => {
    // Should parse harmlessly rather than mutating Object.prototype.
    const before = ({} as Record<string, unknown>).polluted
    htmlToTipTap('<p><img src="x.jpg" __proto__="polluted"></p>')
    expect(({} as Record<string, unknown>).polluted).toBe(before)
  })
})

describe('decodeHtmlEntities', () => {
  it('decodes named, decimal, and hex entities', () => {
    expect(decodeHtmlEntities('&amp;&#65;&#x42;')).toBe('&AB')
  })

  it('leaves unknown entities untouched', () => {
    expect(decodeHtmlEntities('&notarealentity;')).toBe('&notarealentity;')
  })
})

describe('stripHtmlToPlainText', () => {
  it('removes tags and decodes entities for use as a plain-text excerpt', () => {
    expect(stripHtmlToPlainText('<p>It&#8217;s <strong>great</strong>.</p>')).toBe('It’s great .')
  })
})
