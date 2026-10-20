import { describe, it, expect } from 'vitest'
import {
  FALLBACK_IMAGE_RATIO,
  aspectRatioValue,
  imageRatio,
  moveItem,
} from '../../../../packages/canvas/src/utils/gallery'
import { parseImageList } from '../../../../packages/canvas/src/utils/json'
import { getBlockDefinition } from '../../../../packages/canvas/src/blocks/definitions'

describe('imageRatio', () => {
  it('uses the real dimensions when known', () => {
    expect(imageRatio({ width: 1200, height: 800 })).toBe(1.5)
    expect(imageRatio({ width: 800, height: 1200 })).toBeCloseTo(0.667, 3)
  })

  it('falls back to 3:2 when dimensions are missing or nonsense', () => {
    expect(imageRatio({})).toBe(FALLBACK_IMAGE_RATIO)
    expect(imageRatio({ width: 800 })).toBe(FALLBACK_IMAGE_RATIO)
    expect(imageRatio({ width: 0, height: 600 })).toBe(FALLBACK_IMAGE_RATIO)
    expect(imageRatio({ width: -5, height: 600 })).toBe(FALLBACK_IMAGE_RATIO)
  })

  it('clamps panoramas and slivers so one photo cannot take over a row', () => {
    expect(imageRatio({ width: 10000, height: 500 })).toBe(4)
    expect(imageRatio({ width: 100, height: 5000 })).toBe(0.25)
  })
})

describe('aspectRatioValue', () => {
  it('parses the crop-shape options', () => {
    expect(aspectRatioValue('1:1')).toBe(1)
    expect(aspectRatioValue('3:2')).toBe(1.5)
    expect(aspectRatioValue('2:3')).toBeCloseTo(0.667, 3)
  })

  it('treats anything else as square', () => {
    expect(aspectRatioValue(undefined)).toBe(1)
    expect(aspectRatioValue('wide')).toBe(1)
    expect(aspectRatioValue('0:3')).toBe(1)
    expect(aspectRatioValue('3:2; background:url(x)')).toBe(1)
  })
})

describe('moveItem', () => {
  const list = ['a', 'b', 'c', 'd']

  it('moves an item up or down without mutating the input', () => {
    expect(moveItem(list, 2, 0)).toEqual(['c', 'a', 'b', 'd'])
    expect(moveItem(list, 0, 3)).toEqual(['b', 'c', 'd', 'a'])
    expect(list).toEqual(['a', 'b', 'c', 'd'])
  })

  it('clamps the target and ignores an out-of-range source', () => {
    expect(moveItem(list, 0, -1)).toEqual(list)
    expect(moveItem(list, 3, 99)).toEqual(list)
    expect(moveItem(list, 9, 0)).toEqual(list)
  })
})

describe('gallery images with captions', () => {
  it('keeps captions and dimensions when parsing a stored images prop', () => {
    const stored = JSON.stringify([{ url: '/a.jpg', alt: 'Bride', caption: 'First dance', width: 900, height: 600 }, { nope: true }])
    expect(parseImageList(stored)).toEqual([{ url: '/a.jpg', alt: 'Bride', caption: 'First dance', width: 900, height: 600 }])
  })
})

describe('Gallery block definition', () => {
  const def = getBlockDefinition('canvas-gallery')!
  const field = (key: string) => def.fields.find(f => f.key === key)!

  it('offers uncropped layouts and defaults new galleries to masonry', () => {
    expect(field('layout').options!.map(o => o.value)).toEqual(['masonry', 'justified', 'grid'])
    expect(def.defaultProps.layout).toBe('masonry')
  })

  it('shows each layout-specific control only for its layout', () => {
    expect(field('columns').condition!({ layout: 'justified' })).toBe(false)
    expect(field('columns').condition!({ layout: 'masonry' })).toBe(true)
    expect(field('rowHeight').condition!({ layout: 'justified' })).toBe(true)
    expect(field('rowHeight').condition!({ layout: 'grid' })).toBe(false)
    // A gallery saved before `layout` existed renders as the cropped grid.
    expect(field('aspectRatio').condition!({})).toBe(true)
    expect(field('aspectRatio').condition!({ layout: 'masonry' })).toBe(false)
  })
})
