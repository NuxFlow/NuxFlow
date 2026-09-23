import { describe, it, expect } from 'vitest'
import { extractPlainText } from '../../server/utils/tiptap-text'

describe('extractPlainText', () => {
  it('extracts text from a simple paragraph doc', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Hello world.' }] },
      ],
    }
    expect(extractPlainText(doc)).toBe('Hello world.')
  })

  it('joins multiple paragraphs with sentence breaks so the TTS model paces them separately', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'First paragraph' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Second paragraph' }] },
      ],
    }
    const text = extractPlainText(doc)
    expect(text).toContain('First paragraph')
    expect(text).toContain('Second paragraph')
    // A period between the two blocks, not just a bare space — otherwise "First
    // paragraphSecond paragraph" reads as one run-on sentence.
    expect(text).toMatch(/First paragraph\.\s*Second paragraph/)
  })

  it('includes heading text and treats it as its own block boundary', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', content: [{ type: 'text', text: 'Section Title' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Body text.' }] },
      ],
    }
    const text = extractPlainText(doc)
    expect(text).toContain('Section Title')
    expect(text).toContain('Body text.')
  })

  it('concatenates multiple text runs within the same paragraph (e.g. bold/italic marks)', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'This is ' },
            { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' text.' },
          ],
        },
      ],
    }
    expect(extractPlainText(doc)).toBe('This is bold text.')
  })

  it('collapses excess whitespace', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '  lots   of    spaces  ' }] },
      ],
    }
    expect(extractPlainText(doc)).toBe('lots of spaces.')
  })

  it('returns an empty string for an empty document', () => {
    expect(extractPlainText({ type: 'doc', content: [] })).toBe('')
  })

  it('returns an empty string for null/undefined input rather than throwing', () => {
    expect(extractPlainText(null)).toBe('')
    expect(extractPlainText(undefined)).toBe('')
  })

  it('returns an empty string for a canvas document (no text nodes to walk)', () => {
    const doc = { type: 'canvas', blocks: [{ id: '1', type: 'canvas-hero', props: { headline: 'Hi' } }] }
    expect(extractPlainText(doc)).toBe('')
  })
})
