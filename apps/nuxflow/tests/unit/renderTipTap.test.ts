import { describe, it, expect } from 'vitest'
import { renderTipTap } from '../../app/utils/render-tiptap'

// Helpers to build TipTap nodes concisely
const text = (t: string, ...marks: object[]) => ({
  type: 'text', text: t,
  ...(marks.length ? { marks } : {}),
})
const doc = (...content: object[]) => ({ type: 'doc', content })
const p = (...content: object[]) => ({ type: 'paragraph', content })
const h = (level: number, ...content: object[]) => ({ type: 'heading', attrs: { level }, content })
const ul = (...items: object[]) => ({ type: 'bulletList', content: items })
const ol = (start: number, ...items: object[]) => ({ type: 'orderedList', attrs: { start }, content: items })
const li = (...content: object[]) => ({ type: 'listItem', content })
const bold = { type: 'bold' }
const italic = { type: 'italic' }
const code = { type: 'code' }
const strike = { type: 'strike' }

describe('renderTipTap', () => {
  describe('edge cases', () => {
    it('returns empty string for null input', () => {
      expect(renderTipTap(null)).toBe('')
    })

    it('returns empty string for non-object input', () => {
      expect(renderTipTap('hello')).toBe('')
      expect(renderTipTap(42)).toBe('')
    })

    it('renders an array of nodes', () => {
      const result = renderTipTap([p(text('A')), p(text('B'))])
      expect(result).toBe('<p>A</p><p>B</p>')
    })
  })

  describe('doc node', () => {
    it('renders doc by concatenating its children', () => {
      expect(renderTipTap(doc(p(text('Hello'))))).toBe('<p>Hello</p>')
    })
  })

  describe('paragraph', () => {
    it('renders a paragraph with text', () => {
      expect(renderTipTap(p(text('Hello world')))).toBe('<p>Hello world</p>')
    })

    it('renders an empty paragraph as <p><br></p>', () => {
      expect(renderTipTap({ type: 'paragraph' })).toBe('<p><br></p>')
    })
  })

  describe('headings', () => {
    it('renders h1 through h6', () => {
      for (let l = 1; l <= 6; l++) {
        expect(renderTipTap(h(l, text('Title')))).toBe(`<h${l}>Title</h${l}>`)
      }
    })

    it('clamps heading level to 1 when below range', () => {
      expect(renderTipTap({ type: 'heading', attrs: { level: 0 }, content: [text('X')] }))
        .toBe('<h1>X</h1>')
    })

    it('clamps heading level to 6 when above range', () => {
      expect(renderTipTap({ type: 'heading', attrs: { level: 9 }, content: [text('X')] }))
        .toBe('<h6>X</h6>')
    })
  })

  describe('HTML escaping', () => {
    it('escapes & < > " in text nodes', () => {
      expect(renderTipTap(p(text('<script>alert("xss")</script>')))).toBe(
        '<p>&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;</p>',
      )
    })

    it('escapes & in text', () => {
      expect(renderTipTap(p(text('A & B')))).toBe('<p>A &amp; B</p>')
    })

    it('escapes href in link marks', () => {
      const node = { type: 'text', text: 'click', marks: [{ type: 'link', attrs: { href: '"><script>' } }] }
      const result = renderTipTap(node)
      expect(result).not.toContain('<script>')
    })
  })

  describe('text marks', () => {
    it('wraps bold text in <strong>', () => {
      expect(renderTipTap(text('hi', bold))).toBe('<strong>hi</strong>')
    })

    it('wraps italic text in <em>', () => {
      expect(renderTipTap(text('hi', italic))).toBe('<em>hi</em>')
    })

    it('wraps code text in <code>', () => {
      expect(renderTipTap(text('x', code))).toBe('<code>x</code>')
    })

    it('wraps strike text in <s>', () => {
      expect(renderTipTap(text('hi', strike))).toBe('<s>hi</s>')
    })

    it('stacks marks in order: bold then italic', () => {
      // marks are applied left to right, so bold first then italic wraps it
      expect(renderTipTap(text('hi', bold, italic))).toBe('<em><strong>hi</strong></em>')
    })

    it('renders a link with href', () => {
      const node = { type: 'text', text: 'click', marks: [{ type: 'link', attrs: { href: '/page' } }] }
      expect(renderTipTap(node)).toBe('<a href="/page">click</a>')
    })

    it('renders a link with target=_blank and rel', () => {
      const node = { type: 'text', text: 'click', marks: [{ type: 'link', attrs: { href: '/page', target: '_blank' } }] }
      const result = renderTipTap(node)
      expect(result).toContain('rel="noopener noreferrer"')
      expect(result).toContain('target="_blank"')
    })

    it('renders highlight with color', () => {
      const node = { type: 'text', text: 'hi', marks: [{ type: 'highlight', attrs: { color: '#ff0' } }] }
      expect(renderTipTap(node)).toBe('<mark style="background-color:#ff0">hi</mark>')
    })

    it('renders highlight without color', () => {
      const node = { type: 'text', text: 'hi', marks: [{ type: 'highlight' }] }
      expect(renderTipTap(node)).toBe('<mark>hi</mark>')
    })

    it('renders textStyle with color', () => {
      const node = { type: 'text', text: 'hi', marks: [{ type: 'textStyle', attrs: { color: '#f00' } }] }
      expect(renderTipTap(node)).toBe('<span style="color:#f00;">hi</span>')
    })

    it('returns plain text for unknown mark types', () => {
      const node = { type: 'text', text: 'hi', marks: [{ type: 'unknown-mark' }] }
      expect(renderTipTap(node)).toBe('hi')
    })
  })

  describe('structural nodes', () => {
    it('renders hardBreak as <br>', () => {
      expect(renderTipTap({ type: 'hardBreak' })).toBe('<br>')
    })

    it('renders horizontalRule as <hr>', () => {
      expect(renderTipTap({ type: 'horizontalRule' })).toBe('<hr>')
    })

    it('renders blockquote', () => {
      expect(renderTipTap({ type: 'blockquote', content: [p(text('quote'))] }))
        .toBe('<blockquote><p>quote</p></blockquote>')
    })
  })

  describe('lists', () => {
    it('renders a bullet list', () => {
      expect(renderTipTap(ul(li(p(text('A'))), li(p(text('B'))))))
        .toBe('<ul><li><p>A</p></li><li><p>B</p></li></ul>')
    })

    it('renders an ordered list starting at 1 without start attr', () => {
      const result = renderTipTap(ol(1, li(p(text('A')))))
      expect(result).toBe('<ol><li><p>A</p></li></ol>')
    })

    it('renders an ordered list with non-1 start', () => {
      const result = renderTipTap(ol(5, li(p(text('A')))))
      expect(result).toBe('<ol start="5"><li><p>A</p></li></ol>')
    })
  })

  describe('code block', () => {
    it('renders a code block without language', () => {
      const node = { type: 'codeBlock', content: [{ type: 'text', text: 'const x = 1' }] }
      expect(renderTipTap(node)).toBe('<pre><code>const x = 1</code></pre>')
    })

    it('renders a code block with language class', () => {
      const node = { type: 'codeBlock', attrs: { language: 'ts' }, content: [{ type: 'text', text: 'let x' }] }
      expect(renderTipTap(node)).toBe('<pre><code class="language-ts">let x</code></pre>')
    })

    it('escapes HTML inside code blocks', () => {
      const node = { type: 'codeBlock', content: [{ type: 'text', text: '<b>bold</b>' }] }
      expect(renderTipTap(node)).toContain('&lt;b&gt;')
    })
  })

  describe('image', () => {
    it('renders an image with src and lazy loading', () => {
      const node = { type: 'image', attrs: { src: '/img.png', alt: 'A photo' } }
      expect(renderTipTap(node)).toBe('<img src="/img.png" alt="A photo" loading="lazy">')
    })

    it('renders an image with width and height', () => {
      const node = { type: 'image', attrs: { src: '/img.png', width: '800', height: '600' } }
      const result = renderTipTap(node)
      expect(result).toContain('width="800"')
      expect(result).toContain('height="600"')
    })

    it('omits alt when not provided', () => {
      const node = { type: 'image', attrs: { src: '/img.png' } }
      expect(renderTipTap(node)).not.toContain('alt=')
    })
  })

  describe('table', () => {
    it('renders a simple table', () => {
      const node = {
        type: 'table',
        content: [{
          type: 'tableBody',
          content: [{
            type: 'tableRow',
            content: [
              { type: 'tableCell', content: [p(text('A'))] },
              { type: 'tableHeader', content: [p(text('B'))] },
            ],
          }],
        }],
      }
      const result = renderTipTap(node)
      expect(result).toContain('<table>')
      expect(result).toContain('<tbody>')
      expect(result).toContain('<tr>')
      expect(result).toContain('<td><p>A</p></td>')
      expect(result).toContain('<th><p>B</p></th>')
    })

    it('renders colspan and rowspan attributes', () => {
      const cell = { type: 'tableCell', attrs: { colspan: 2, rowspan: 3 }, content: [p(text('X'))] }
      const result = renderTipTap(cell)
      expect(result).toContain('colspan="2"')
      expect(result).toContain('rowspan="3"')
    })

    it('omits colspan/rowspan when value is 1', () => {
      const cell = { type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [p(text('X'))] }
      const result = renderTipTap(cell)
      expect(result).not.toContain('colspan')
      expect(result).not.toContain('rowspan')
    })
  })

  describe('task list', () => {
    it('renders an unchecked task item', () => {
      const node = { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [p(text('Todo'))] }] }
      const result = renderTipTap(node)
      expect(result).toContain('class="nux-task-list"')
      expect(result).toContain('class="nux-task-item"')
      expect(result).toContain('type="checkbox" disabled')
      expect(result).not.toContain('checked')
    })

    it('renders a checked task item', () => {
      const node = { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [p(text('Done'))] }] }
      expect(renderTipTap(node)).toContain('disabled checked')
    })
  })

  describe('unknown node types', () => {
    it('falls through to rendering children for unknown types', () => {
      const node = { type: 'custom-widget', content: [p(text('inner'))] }
      expect(renderTipTap(node)).toBe('<p>inner</p>')
    })
  })
})
