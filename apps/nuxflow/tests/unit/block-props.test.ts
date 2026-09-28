import { describe, it, expect } from 'vitest'
import { toComponentProps } from '../../../../packages/canvas/src/utils/block-props'
import { CANVAS_BLOCKS } from '../../../../packages/canvas/src/blocks/definitions'

describe('toComponentProps', () => {
  it('renames Vue-reserved field keys so they reach the component as props', () => {
    expect(toComponentProps({ style: 'card', align: 'left' })).toEqual({ blockStyle: 'card', align: 'left' })
    expect(toComponentProps({ class: 'x' })).toEqual({ blockClass: 'x' })
  })

  it('returns the same object when nothing needs renaming, and never mutates the stored props', () => {
    const stored = { headline: 'Hi' }
    expect(toComponentProps(stored)).toBe(stored)
    const withStyle = { style: 'large' }
    toComponentProps(withStyle)
    expect(withStyle).toEqual({ style: 'large' })
  })

  it('leaves keys that merely exist on Object.prototype alone', () => {
    const props = { constructor: 'x', toString: 'y', style: 'card' }
    expect(toComponentProps(props)).toEqual({ constructor: 'x', toString: 'y', blockStyle: 'card' })
  })

  it('handles missing props', () => {
    expect(toComponentProps(undefined)).toEqual({})
    expect(toComponentProps(null)).toEqual({})
  })

  // Guard: any block field keyed `style`/`class` must be read as blockStyle/blockClass by
  // its component — this lists which blocks rely on the rename, so a new one is noticed.
  it('is needed only by the blocks known to use a reserved field key', () => {
    const reserved = CANVAS_BLOCKS
      .filter(b => b.fields.some(f => f.key === 'style' || f.key === 'class'))
      .map(b => b.id)
      .sort()
    expect(reserved).toEqual(['canvas-features', 'canvas-testimonial'])
  })
})
