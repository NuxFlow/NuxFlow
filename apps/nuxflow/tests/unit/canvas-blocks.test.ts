import { describe, it, expect } from 'vitest'
import {
  CANVAS_BLOCKS,
  getBlockDefinition,
  registerBlockDefinition,
  getDynamicBlockDefinitions,
} from '../../../../packages/canvas/src/blocks/definitions'

// ---------------------------------------------------------------------------
// Block registry structure
// ---------------------------------------------------------------------------

describe('CANVAS_BLOCKS registry', () => {
  it('contains all required built-in blocks', () => {
    const ids = CANVAS_BLOCKS.map(b => b.id)
    expect(ids).toContain('canvas-hero')
    expect(ids).toContain('canvas-text')
    expect(ids).toContain('canvas-image')
    expect(ids).toContain('canvas-video')
    expect(ids).toContain('canvas-columns')
    expect(ids).toContain('canvas-container')
    expect(ids).toContain('canvas-features')
    expect(ids).toContain('canvas-testimonial')
    expect(ids).toContain('canvas-cta')
    expect(ids).toContain('canvas-spacer')
    expect(ids).toContain('canvas-gdpr')
    expect(ids).toContain('canvas-footer')
    expect(ids).toContain('canvas-button')
    expect(ids).toContain('canvas-accordion')
    expect(ids).toContain('canvas-pricing')
    expect(ids).toContain('canvas-gallery')
    expect(ids).toContain('canvas-carousel')
    expect(ids).toContain('canvas-calendar')
    expect(ids).toContain('contact-form/form')
    expect(ids).toContain('html-block/html')
    expect(ids).toContain('payments/memberships')
  })

  it('every block has required metadata fields', () => {
    for (const block of CANVAS_BLOCKS) {
      expect(typeof block.id, `${block.id} missing id`).toBe('string')
      expect(typeof block.name, `${block.id} missing name`).toBe('string')
      expect(typeof block.component, `${block.id} missing component`).toBe('string')
      expect(typeof block.category, `${block.id} missing category`).toBe('string')
      expect(Array.isArray(block.fields), `${block.id} fields not array`).toBe(true)
      expect(typeof block.defaultProps, `${block.id} missing defaultProps`).toBe('object')
    }
  })

  it('every block has unique ids', () => {
    const ids = CANVAS_BLOCKS.map(b => b.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })

  it('every field with type select has non-empty options', () => {
    for (const block of CANVAS_BLOCKS) {
      for (const field of block.fields) {
        if (field.type === 'select') {
          expect(
            Array.isArray(field.options) && field.options.length > 0,
            `${block.id}.${field.key} select has no options`,
          ).toBe(true)
        }
      }
    }
  })
})

// ---------------------------------------------------------------------------
// GDPR block
// ---------------------------------------------------------------------------

describe('canvas-gdpr block definition', () => {
  const gdpr = CANVAS_BLOCKS.find(b => b.id === 'canvas-gdpr')!

  it('exists in the registry', () => {
    expect(gdpr).toBeDefined()
  })

  it('is in the cta category', () => {
    expect(gdpr.category).toBe('cta')
  })

  it('has targeting field with correct options', () => {
    const targeting = gdpr.fields.find(f => f.key === 'targeting')!
    expect(targeting).toBeDefined()
    expect(targeting.type).toBe('select')
    const values = (targeting.options as { value: string }[]).map(o => o.value)
    expect(values).toContain('everyone')
    expect(values).toContain('gdpr-only')
  })

  it('defaults to gdpr-only targeting', () => {
    expect(gdpr.defaultProps.targeting).toBe('gdpr-only')
  })

  it('has showPreferences toggle field', () => {
    const toggle = gdpr.fields.find(f => f.key === 'showPreferences')
    expect(toggle).toBeDefined()
    expect(toggle?.type).toBe('toggle')
  })

  it('preferencesLabel field is conditional on showPreferences', () => {
    const prefLabel = gdpr.fields.find(f => f.key === 'preferencesLabel')!
    expect(typeof prefLabel.condition).toBe('function')
    expect(prefLabel.condition!({ showPreferences: true })).toBe(true)
    expect(prefLabel.condition!({ showPreferences: false })).toBe(false)
  })

  it('has required colour fields', () => {
    const keys = gdpr.fields.map(f => f.key)
    expect(keys).toContain('bgColor')
    expect(keys).toContain('textColor')
    expect(keys).toContain('btnColor')
  })
})

// ---------------------------------------------------------------------------
// Columns block (nested slots)
// ---------------------------------------------------------------------------

describe('canvas-columns block definition', () => {
  const columns = CANVAS_BLOCKS.find(b => b.id === 'canvas-columns')!

  it('exists in the registry', () => {
    expect(columns).toBeDefined()
  })

  it('is in the layout category', () => {
    expect(columns.category).toBe('layout')
  })

  it('no longer has col1-col4 rich text props', () => {
    const keys = columns.fields.map(f => f.key)
    expect(keys).not.toContain('col1')
    expect(keys).not.toContain('col2')
    expect(keys).not.toContain('col3')
    expect(keys).not.toContain('col4')
  })

  it('declares 4 named slots for nested child blocks', () => {
    const slotIds = columns.slots?.map(s => s.id)
    expect(slotIds).toEqual(['col1', 'col2', 'col3', 'col4'])
  })

  it('col3/col4 slots are conditional on the columns count', () => {
    const col3 = columns.slots!.find(s => s.id === 'col3')!
    const col4 = columns.slots!.find(s => s.id === 'col4')!
    expect(col3.condition!({ columns: '2' })).toBe(false)
    expect(col3.condition!({ columns: '3' })).toBe(true)
    expect(col4.condition!({ columns: '3' })).toBe(false)
    expect(col4.condition!({ columns: '4' })).toBe(true)
  })

  it('col1/col2 have no condition — always visible', () => {
    const col1 = columns.slots!.find(s => s.id === 'col1')!
    const col2 = columns.slots!.find(s => s.id === 'col2')!
    expect(col1.condition).toBeUndefined()
    expect(col2.condition).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Container block (nested slot)
// ---------------------------------------------------------------------------

describe('canvas-container block definition', () => {
  const container = CANVAS_BLOCKS.find(b => b.id === 'canvas-container')!

  it('exists in the registry', () => {
    expect(container).toBeDefined()
  })

  it('is in the layout category', () => {
    expect(container.category).toBe('layout')
  })

  it('declares a single default slot', () => {
    expect(container.slots).toEqual([{ id: 'default', label: 'Content' }])
  })

  it('has bgColor, maxWidth, and padding fields', () => {
    const keys = container.fields.map(f => f.key)
    expect(keys).toContain('bgColor')
    expect(keys).toContain('maxWidth')
    expect(keys).toContain('padding')
  })
})

// ---------------------------------------------------------------------------
// Video block
// ---------------------------------------------------------------------------

describe('canvas-video block definition', () => {
  const video = CANVAS_BLOCKS.find(b => b.id === 'canvas-video')!

  it('exists in the registry', () => {
    expect(video).toBeDefined()
  })

  it('is in the media category', () => {
    expect(video.category).toBe('media')
  })

  it('has url field of type url', () => {
    const urlField = video.fields.find(f => f.key === 'url')
    expect(urlField?.type).toBe('url')
  })

  it('has aspectRatio select with all expected values', () => {
    const ar = video.fields.find(f => f.key === 'aspectRatio')!
    expect(ar.type).toBe('select')
    const values = (ar.options as { value: string }[]).map(o => o.value)
    expect(values).toContain('16:9')
    expect(values).toContain('4:3')
    expect(values).toContain('1:1')
    expect(values).toContain('9:16')
  })

  it('defaults to 16:9 aspect ratio and no autoplay', () => {
    expect(video.defaultProps.aspectRatio).toBe('16:9')
    expect(video.defaultProps.autoplay).toBe(false)
    expect(video.defaultProps.muted).toBe(false)
  })

  it('muted field is conditional on autoplay', () => {
    const muted = video.fields.find(f => f.key === 'muted')!
    expect(typeof muted.condition).toBe('function')
    expect(muted.condition!({ autoplay: true })).toBe(true)
    expect(muted.condition!({ autoplay: false })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Image block focal point
// ---------------------------------------------------------------------------

describe('canvas-image block definition', () => {
  const image = CANVAS_BLOCKS.find(b => b.id === 'canvas-image')!

  it('has focalX and focalY number fields', () => {
    const fx = image.fields.find(f => f.key === 'focalX')
    const fy = image.fields.find(f => f.key === 'focalY')
    expect(fx?.type).toBe('number')
    expect(fy?.type).toBe('number')
  })

  it('focal fields are constrained 0–100', () => {
    const fx = image.fields.find(f => f.key === 'focalX')!
    const fy = image.fields.find(f => f.key === 'focalY')!
    expect(fx.min).toBe(0)
    expect(fx.max).toBe(100)
    expect(fy.min).toBe(0)
    expect(fy.max).toBe(100)
  })

  it('defaults focal point to center (50, 50)', () => {
    expect(image.defaultProps.focalX).toBe(50)
    expect(image.defaultProps.focalY).toBe(50)
  })
})

// ---------------------------------------------------------------------------
// Carousel block
// ---------------------------------------------------------------------------

describe('canvas-carousel block definition', () => {
  const carousel = CANVAS_BLOCKS.find(b => b.id === 'canvas-carousel')!

  it('exists in the registry', () => {
    expect(carousel).toBeDefined()
  })

  it('is in the media category', () => {
    expect(carousel.category).toBe('media')
  })

  it('has an images field', () => {
    const images = carousel.fields.find(f => f.key === 'images')
    expect(images?.type).toBe('images')
  })

  it('has aspectRatio select with all expected values', () => {
    const ar = carousel.fields.find(f => f.key === 'aspectRatio')!
    expect(ar.type).toBe('select')
    const values = (ar.options as { value: string }[]).map(o => o.value)
    expect(values).toContain('16:9')
    expect(values).toContain('21:9')
    expect(values).toContain('4:3')
    expect(values).toContain('1:1')
  })

  it('defaults to autoplay enabled with a 5000ms interval', () => {
    expect(carousel.defaultProps.autoplay).toBe(true)
    expect(carousel.defaultProps.interval).toBe(5000)
  })

  it('interval field is conditional on autoplay', () => {
    const interval = carousel.fields.find(f => f.key === 'interval')!
    expect(typeof interval.condition).toBe('function')
    expect(interval.condition!({ autoplay: true })).toBe(true)
    expect(interval.condition!({ autoplay: false })).toBe(false)
  })

  it('has arrows and dots toggles defaulting to true', () => {
    const keys = carousel.fields.map(f => f.key)
    expect(keys).toContain('arrows')
    expect(keys).toContain('dots')
    expect(carousel.defaultProps.arrows).toBe(true)
    expect(carousel.defaultProps.dots).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Contact Form block
// ---------------------------------------------------------------------------

describe('contact-form/form block definition', () => {
  const block = CANVAS_BLOCKS.find(b => b.id === 'contact-form/form')!

  it('exists in the registry', () => {
    expect(block).toBeDefined()
  })

  it('is in the forms category', () => {
    expect(block.category).toBe('forms')
  })

  it('has title, description, and submitLabel fields', () => {
    const keys = block.fields.map(f => f.key)
    expect(keys).toContain('title')
    expect(keys).toContain('description')
    expect(keys).toContain('submitLabel')
  })
})

// ---------------------------------------------------------------------------
// HTML block
// ---------------------------------------------------------------------------

describe('html-block/html block definition', () => {
  const block = CANVAS_BLOCKS.find(b => b.id === 'html-block/html')!

  it('exists in the registry', () => {
    expect(block).toBeDefined()
  })

  it('is in the advanced category', () => {
    expect(block.category).toBe('advanced')
  })

  it('has an html textarea field', () => {
    const html = block.fields.find(f => f.key === 'html')
    expect(html?.type).toBe('textarea')
  })
})

// ---------------------------------------------------------------------------
// Membership Pricing block
// ---------------------------------------------------------------------------

describe('payments/memberships block definition', () => {
  const block = CANVAS_BLOCKS.find(b => b.id === 'payments/memberships')!

  it('exists in the registry', () => {
    expect(block).toBeDefined()
  })

  it('is in the commerce category', () => {
    expect(block.category).toBe('commerce')
  })

  it('has title, subtitle, and ctaLabel fields', () => {
    const keys = block.fields.map(f => f.key)
    expect(keys).toContain('title')
    expect(keys).toContain('subtitle')
    expect(keys).toContain('ctaLabel')
  })
})

// ---------------------------------------------------------------------------
// getBlockDefinition lookup
// ---------------------------------------------------------------------------

describe('getBlockDefinition', () => {
  it('returns a block for a known id', () => {
    const def = getBlockDefinition('canvas-hero')
    expect(def).toBeDefined()
    expect(def?.id).toBe('canvas-hero')
  })

  it('returns undefined for an unknown id', () => {
    expect(getBlockDefinition('canvas-does-not-exist')).toBeUndefined()
  })

  it('returns plugin-registered blocks', () => {
    registerBlockDefinition({
      id: 'test-plugin-block',
      name: 'Test Plugin',
      description: 'A test block',
      icon: 'i-lucide-box',
      category: 'content',
      component: 'TestPluginBlock',
      thumbnailColor: '#fff',
      fields: [],
      defaultProps: {},
    })

    const def = getBlockDefinition('test-plugin-block')
    expect(def).toBeDefined()
    expect(def?.id).toBe('test-plugin-block')
  })

  it('does not register the same dynamic block twice', () => {
    const before = getDynamicBlockDefinitions().length
    registerBlockDefinition({
      id: 'test-plugin-block',
      name: 'Test Plugin',
      description: 'Duplicate',
      icon: 'i-lucide-box',
      category: 'content',
      component: 'TestPluginBlock',
      thumbnailColor: '#fff',
      fields: [],
      defaultProps: {},
    })

    expect(getDynamicBlockDefinitions().length).toBe(before)
  })
})

// ---------------------------------------------------------------------------
// Video URL parsing logic (mirrors CanvasBlockVideo.vue embedUrl)
// ---------------------------------------------------------------------------

// Extracted from CanvasBlockVideo.vue for isolated unit testing
function buildEmbedUrl(
  url: string,
  autoplay: boolean,
  muted: boolean,
): string | null {
  const raw = url.trim()
  if (!raw) return null

  // Cloudflare Stream
  const cfStream = raw.match(
    /(?:videodelivery\.net\/|cloudflarestream\.com\/|watch\.cloudflarestream\.com\/|^)([a-f0-9]{32})(?:\/iframe)?$/i,
  )
  if (cfStream) {
    const params = new URLSearchParams()
    if (autoplay) params.set('autoplay', 'true')
    if (muted) params.set('muted', 'true')
    params.set('controls', 'true')
    return `https://iframe.videodelivery.net/${cfStream[1]}?${params}`
  }

  // YouTube
  const yt = raw.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{11})/,
  )
  if (yt) {
    const params = new URLSearchParams({ rel: '0', modestbranding: '1' })
    if (autoplay) params.set('autoplay', '1')
    if (muted) params.set('mute', '1')
    return `https://www.youtube.com/embed/${yt[1]}?${params}`
  }

  // Vimeo
  const vimeo = raw.match(/vimeo\.com\/(\d+)/)
  if (vimeo) {
    const params = new URLSearchParams()
    if (autoplay) params.set('autoplay', '1')
    if (muted) params.set('muted', '1')
    return `https://player.vimeo.com/video/${vimeo[1]}?${params}`
  }

  return null
}

describe('Video embed URL parsing', () => {
  describe('YouTube', () => {
    it('parses a standard youtube.com/watch URL', () => {
      const url = buildEmbedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ', false, false)
      expect(url).toContain('youtube.com/embed/dQw4w9WgXcQ')
    })

    it('parses a short youtu.be URL', () => {
      const url = buildEmbedUrl('https://youtu.be/dQw4w9WgXcQ', false, false)
      expect(url).toContain('youtube.com/embed/dQw4w9WgXcQ')
    })

    it('parses an already-embedded youtube URL', () => {
      const url = buildEmbedUrl('https://www.youtube.com/embed/dQw4w9WgXcQ', false, false)
      expect(url).toContain('youtube.com/embed/dQw4w9WgXcQ')
    })

    it('includes autoplay param when enabled', () => {
      const url = buildEmbedUrl('https://youtu.be/dQw4w9WgXcQ', true, false)!
      expect(url).toContain('autoplay=1')
    })

    it('includes mute param when muted is enabled', () => {
      const url = buildEmbedUrl('https://youtu.be/dQw4w9WgXcQ', false, true)!
      expect(url).toContain('mute=1')
    })

    it('always includes rel=0 and modestbranding', () => {
      const url = buildEmbedUrl('https://youtu.be/dQw4w9WgXcQ', false, false)!
      expect(url).toContain('rel=0')
      expect(url).toContain('modestbranding=1')
    })
  })

  describe('Vimeo', () => {
    it('parses a vimeo.com URL', () => {
      const url = buildEmbedUrl('https://vimeo.com/123456789', false, false)
      expect(url).toContain('player.vimeo.com/video/123456789')
    })

    it('includes autoplay param when enabled', () => {
      const url = buildEmbedUrl('https://vimeo.com/987654321', true, false)!
      expect(url).toContain('autoplay=1')
    })

    it('includes muted param when enabled', () => {
      const url = buildEmbedUrl('https://vimeo.com/987654321', false, true)!
      expect(url).toContain('muted=1')
    })
  })

  describe('Cloudflare Stream', () => {
    const cfUid = 'abcdef1234567890abcdef1234567890'

    it('parses a videodelivery.net URL', () => {
      const url = buildEmbedUrl(`https://iframe.videodelivery.net/${cfUid}`, false, false)
      expect(url).toContain(`iframe.videodelivery.net/${cfUid}`)
    })

    it('parses a bare 32-char hex UID', () => {
      const url = buildEmbedUrl(cfUid, false, false)
      expect(url).toContain(`iframe.videodelivery.net/${cfUid}`)
    })

    it('always includes controls=true', () => {
      const url = buildEmbedUrl(cfUid, false, false)!
      expect(url).toContain('controls=true')
    })

    it('includes autoplay when enabled', () => {
      const url = buildEmbedUrl(cfUid, true, false)!
      expect(url).toContain('autoplay=true')
    })

    it('includes muted when enabled', () => {
      const url = buildEmbedUrl(cfUid, false, true)!
      expect(url).toContain('muted=true')
    })
  })

  describe('invalid / unrecognised URLs', () => {
    it('returns null for an empty string', () => {
      expect(buildEmbedUrl('', false, false)).toBeNull()
    })

    it('returns null for a non-video URL', () => {
      expect(buildEmbedUrl('https://example.com/page', false, false)).toBeNull()
    })

    it('returns null for a random string', () => {
      expect(buildEmbedUrl('not a url at all', false, false)).toBeNull()
    })
  })
})
