import { describe, it, expect } from 'vitest'
import { findGalleryBlock, galleryImageUrls, uniqueFileNames } from '../../server/utils/gallery-download'
import { getBlockDefinition } from '../../../../packages/canvas/src/blocks/definitions'

const gallery = (id: string, images: unknown[] = [], extra: Record<string, unknown> = {}) =>
  ({ id, type: 'canvas-gallery', props: { images: JSON.stringify(images), ...extra } })

describe('findGalleryBlock', () => {
  it('finds a gallery at the top level or inside layout slots', () => {
    const content = {
      type: 'canvas',
      blocks: [
        { id: 't', type: 'canvas-text', props: {} },
        { id: 'c', type: 'canvas-columns', props: {}, children: { col2: [gallery('nested')] } },
        gallery('top'),
      ],
    }
    expect(findGalleryBlock(content, 'top')?.id).toBe('top')
    expect(findGalleryBlock(content, 'nested')?.id).toBe('nested')
  })

  it('only matches galleries', () => {
    const content = { blocks: [{ id: 't', type: 'canvas-text', props: {} }] }
    expect(findGalleryBlock(content, 't')).toBeNull()
    expect(findGalleryBlock(null, 'x')).toBeNull()
    expect(findGalleryBlock({ type: 'doc', content: [] }, 'x')).toBeNull()
  })
})

describe('galleryImageUrls', () => {
  it('reads urls in order and ignores junk', () => {
    expect(galleryImageUrls(gallery('g', [{ url: '/a.jpg' }, { nope: 1 }, 'x', { url: '/b.jpg' }]))).toEqual(['/a.jpg', '/b.jpg'])
    expect(galleryImageUrls({ props: { images: 'not json' } })).toEqual([])
  })
})

describe('uniqueFileNames', () => {
  it('de-duplicates case-insensitively, keeping the extension', () => {
    expect(uniqueFileNames(['DSC_1.jpg', 'dsc_1.JPG', 'DSC_1.jpg', 'other.png'])).toEqual(['DSC_1.jpg', 'dsc_1 (2).JPG', 'DSC_1 (3).jpg', 'other.png'])
  })

  it('makes names safe as one zip path segment', () => {
    expect(uniqueFileNames(['../../etc/passwd', 'a\\b.jpg', '...hidden', 'bad\u0007name.jpg', ''])).toEqual([
      '_.._etc_passwd',
      'a_b.jpg',
      'hidden',
      'badname.jpg',
      'photo',
    ])
  })
})

describe('Gallery definition', () => {
  it('has downloads off by default and never lets AI switch them on', () => {
    const def = getBlockDefinition('canvas-gallery')!
    expect(def.defaultProps.allowDownload).toBe(false)
    expect(def.fields.find(f => f.key === 'allowDownload')?.ai).toBe(false)
  })
})
