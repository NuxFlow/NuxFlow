import { describe, it, expect } from 'vitest'
import { countWords, headingId, postOutline, tocHeadings } from '../../shared/lib/post-outline'
import { renderTipTap } from '../../shared/lib/render-tiptap'

const text = (t: string) => ({ type: 'text', text: t })
const heading = (level: number, t: string) => ({ type: 'heading', attrs: { level }, content: [text(t)] })
const para = (t: string) => ({ type: 'paragraph', content: [text(t)] })

describe('headingId', () => {
  it('makes readable ids in any script, and numbers repeats', () => {
    const used = new Map<string, number>()
    expect(headingId('What does it cost?', used)).toBe('what-does-it-cost')
    expect(headingId('What does it cost?', used)).toBe('what-does-it-cost-2')
    expect(headingId('Über uns', used)).toBe('über-uns')
    expect(headingId('料金', used)).toBe('料金')
    expect(headingId('!!!', used)).toBe('section')
  })
})

describe('countWords', () => {
  it('counts words, including contractions and hyphenated ones once', () => {
    expect(countWords("We're a family-run firm — since 1998.")).toBe(6)
  })

  it('counts each CJK character', () => {
    expect(countWords('東京の天気 is nice')).toBe(5 + 2)
  })
})

describe('postOutline', () => {
  it('works out reading time at 230 words a minute, at least a minute', () => {
    const long = { type: 'doc', content: [para(Array.from({ length: 690 }, () => 'word').join(' '))] }
    expect(postOutline(long).readingMinutes).toBe(3)
    expect(postOutline({ type: 'doc', content: [para('Short.')] }).readingMinutes).toBe(1)
    expect(postOutline({ type: 'doc', content: [] }).readingMinutes).toBe(0)
  })

  it('gives every TOC entry the id the renderer gives its heading', () => {
    const doc = {
      type: 'doc',
      content: [
        heading(2, 'Intro'), para('a'),
        { type: 'blockquote', content: [heading(3, 'Quoted')] },
        heading(2, 'Intro'), heading(4, 'Detail'),
      ],
    }
    const html = renderTipTap(doc)
    for (const h of postOutline(doc).headings) expect(html).toContain(`id="${h.id}"`)
    expect(postOutline(doc).headings.map(h => h.id)).toEqual(['intro', 'quoted', 'intro-2', 'detail'])
  })
})

describe('tocHeadings', () => {
  it('lists h2 and h3 only, and only once there are three', () => {
    const two = postOutline({ type: 'doc', content: [heading(2, 'A'), heading(2, 'B'), heading(4, 'C')] })
    expect(tocHeadings(two)).toEqual([])
    const three = postOutline({ type: 'doc', content: [heading(1, 'Title'), heading(2, 'A'), heading(3, 'A.1'), heading(2, 'B')] })
    expect(tocHeadings(three).map(h => h.text)).toEqual(['A', 'A.1', 'B'])
  })
})
