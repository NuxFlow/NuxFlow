import { describe, it, expect } from 'vitest'
import { canvasToMarkdown, contentToMarkdown, decodeEntities, escapeMarkdown, htmlToMarkdown, pageToMarkdown, tiptapToMarkdown } from '../../server/utils/markdown'

describe('escapeMarkdown / decodeEntities', () => {
  it('escapes inline-formatting characters', () => {
    expect(escapeMarkdown('a *b* _c_ [d] `e` \\')).toBe('a \\*b\\* \\_c\\_ \\[d\\] \\`e\\` \\\\')
  })

  it('decodes named and numeric entities, leaving unknown ones intact', () => {
    expect(decodeEntities('Fish &amp; chips &#8212; &#x2014; &nbsp;&bogus;')).toBe('Fish & chips — —  &bogus;'.replace(' ', ' '))
  })
})

describe('htmlToMarkdown', () => {
  it('converts headings, emphasis, links, and paragraphs', () => {
    const md = htmlToMarkdown('<h2>Title</h2><p>Some <strong>bold</strong> and <em>italic</em> with a <a href="https://x.test/a">link</a>.</p>')
    expect(md).toBe('## Title\n\nSome **bold** and _italic_ with a [link](https://x.test/a).')
  })

  it('renders ordered and unordered lists, including nesting', () => {
    const md = htmlToMarkdown('<ul><li>One</li><li>Two<ul><li>Two A</li></ul></li></ul><ol><li>First</li><li>Second</li></ol>')
    expect(md).toContain('- One')
    expect(md).toContain('- Two')
    expect(md).toContain('  - Two A')
    expect(md).toContain('1. First')
    expect(md).toContain('2. Second')
  })

  it('renders blockquotes, code blocks, images, and rules', () => {
    const md = htmlToMarkdown('<blockquote><p>Quoted</p></blockquote><pre><code>const a = 1\nconst b = 2</code></pre><img src="/x.png" alt="An image"><hr>')
    expect(md).toContain('> Quoted')
    expect(md).toContain('```\nconst a = 1\nconst b = 2\n```')
    expect(md).toContain('![An image](/x.png)')
    expect(md).toContain('---')
  })

  it('drops script/style content and javascript: link targets', () => {
    const md = htmlToMarkdown('<p>Hi</p><script>alert(1)</script><style>p{}</style><a href="javascript:alert(2)">click</a>')
    expect(md).not.toContain('alert')
    expect(md).not.toContain('p{}')
    expect(md).toContain('click')
    expect(md).not.toContain('](')
  })

  it('survives malformed HTML without losing text', () => {
    expect(htmlToMarkdown('<p>Unclosed <strong>bold <a href="/x">link')).toContain('Unclosed')
    expect(htmlToMarkdown('text with a stray < sign')).toContain('stray')
  })

  it('escapes literal Markdown characters in text', () => {
    expect(htmlToMarkdown('<p>2 * 3 = 6</p>')).toBe('2 \\* 3 = 6')
  })
})

describe('tiptapToMarkdown', () => {
  it('renders marks, headings, and paragraphs', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Intro' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Bold', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' and ' },
            { type: 'text', text: 'linked', marks: [{ type: 'link', attrs: { href: 'https://x.test' } }] },
            { type: 'text', text: ' and ' },
            { type: 'text', text: 'code', marks: [{ type: 'code' }] },
          ],
        },
      ],
    }
    expect(tiptapToMarkdown(doc)).toBe('## Intro\n\n**Bold** and [linked](https://x.test) and `code`')
  })

  it('renders nested lists, code blocks, and tables', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }] },
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'B' }] },
                { type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'B1' }] }] }] },
              ],
            },
          ],
        },
        { type: 'codeBlock', attrs: { language: 'ts' }, content: [{ type: 'text', text: 'let x = 1' }] },
        {
          type: 'table',
          content: [
            { type: 'tableRow', content: [{ type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'H1' }] }] }, { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'H2' }] }] }] },
            { type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a|b' }] }] }, { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'c' }] }] }] },
          ],
        },
      ],
    }
    const md = tiptapToMarkdown(doc)
    expect(md).toContain('- A\n- B\n  1. B1')
    expect(md).toContain('```ts\nlet x = 1\n```')
    expect(md).toContain('| H1 | H2 |\n| --- | --- |\n| a\\|b | c |')
  })

  it('neutralizes javascript: links and image sources', () => {
    const md = tiptapToMarkdown({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] },
        { type: 'image', attrs: { src: 'javascript:alert(2)', alt: 'evil' } },
      ],
    })
    expect(md).not.toContain('javascript:')
  })

  it('returns empty for non-documents', () => {
    expect(tiptapToMarkdown(null)).toBe('')
  })
})

describe('canvasToMarkdown', () => {
  it('renders content blocks and skips chrome', () => {
    const md = canvasToMarkdown({
      type: 'canvas',
      blocks: [
        { id: '1', type: 'canvas-hero', props: { headline: 'Welcome', subtext: 'We build things', ctaLabel: 'Start', ctaUrl: '/start' } },
        { id: '2', type: 'canvas-spacer', props: { height: 40 } },
        { id: '3', type: 'canvas-text', props: { content: '<p>Rich <strong>text</strong></p>' } },
        { id: '4', type: 'canvas-accordion', props: { title: 'FAQ', itemsJson: '[{"question":"Why?","answer":"Because."}]' } },
        { id: '5', type: 'canvas-pricing', props: { title: 'Plans', numPlans: '2', plan1Name: 'Free', plan1Price: '0', plan1Period: '/mo', plan1Features: '["1 site"]', plan2Name: 'Pro', plan2Price: '29', plan2Period: '/mo' } },
        { id: '6', type: 'canvas-image', props: { src: { url: '/img.png', width: 1, height: 1 }, alt: 'Pic', caption: 'Caption' } },
      ],
    })
    expect(md).toContain('## Welcome')
    expect(md).toContain('We build things')
    expect(md).toContain('[Start](/start)')
    expect(md).toContain('Rich **text**')
    expect(md).toContain('## FAQ')
    expect(md).toContain('### Why?')
    expect(md).toContain('Because.')
    expect(md).toContain('### Free — 0/mo')
    expect(md).toContain('- 1 site')
    expect(md).toContain('### Pro — 29/mo')
    expect(md).toContain('![Pic](/img.png)')
    expect(md).not.toContain('40')
  })

  it('recurses into layout block slots and falls back to text props for unknown blocks', () => {
    const md = canvasToMarkdown({
      type: 'canvas',
      blocks: [
        {
          id: 'c',
          type: 'canvas-columns',
          props: {},
          children: { col1: [{ id: 'x', type: 'canvas-cta', props: { headline: 'Join us', btnLabel: 'Sign up', btnUrl: '/join' } }] },
        },
        { id: 'p', type: 'acme/testimonial-wall', props: { title: 'Loved by teams', description: 'Plugin block text' } },
      ],
    })
    expect(md).toContain('## Join us')
    expect(md).toContain('[Sign up](/join)')
    expect(md).toContain('## Loved by teams')
    expect(md).toContain('Plugin block text')
  })

  it('contentToMarkdown dispatches by document kind', () => {
    expect(contentToMarkdown({ type: 'canvas', blocks: [{ id: '1', type: 'canvas-text', props: { content: '<p>C</p>' } }] })).toBe('C')
    expect(contentToMarkdown({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'T' }] }] })).toBe('T')
    expect(contentToMarkdown('<p>H</p>')).toBe('H')
  })
})

describe('pageToMarkdown', () => {
  it('writes YAML front matter with safely quoted values, an H1, and the body', () => {
    const md = pageToMarkdown(
      { title: 'Say "hi": a guide', url: 'https://x.test/hi', description: 'Line: one', updatedAt: '2026-09-27T00:00:00Z' },
      { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body' }] }] },
    )
    expect(md.startsWith('---\ntitle: "Say \\"hi\\": a guide"\nurl: "https://x.test/hi"\ndescription: "Line: one"\nupdated: "2026-09-27T00:00:00Z"\n---\n')).toBe(true)
    expect(md).toContain('# Say "hi": a guide')
    expect(md).toContain('\n\nBody\n')
  })
})
