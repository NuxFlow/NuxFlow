import { describe, it, expect } from 'vitest'
import { inlineImageProblem, longestInlineImage, MAX_INLINE_IMAGE_CHARS } from '../../server/utils/inline-images'

const big = `data:image/png;base64,${'A'.repeat(MAX_INLINE_IMAGE_CHARS)}`
const icon = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='

describe('inline images in content', () => {
  it('measures the longest data:image URI, stopping at quotes, brackets and spaces', () => {
    expect(longestInlineImage('no images here')).toBe(0)
    expect(longestInlineImage(`<img src="${icon}"> and url(${icon})`)).toBe(icon.length)
    expect(longestInlineImage(`"${icon}" "${big}"`)).toBe(big.length)
  })

  it('refuses a TipTap document with an embedded photo', () => {
    const doc = { type: 'doc', content: [{ type: 'image', attrs: { src: big } }] }
    expect(inlineImageProblem({ content: doc })).toMatch(/media library/)
  })

  it('refuses a large image anywhere in the values, including plain strings', () => {
    expect(inlineImageProblem(undefined, null, big)).toBeDefined()
    expect(inlineImageProblem({ 'site.logo_url': big })).toBeDefined()
  })

  it('allows small inline icons, ordinary URLs and empty values', () => {
    expect(inlineImageProblem({ content: { type: 'doc', content: [{ type: 'html', attrs: { html: `<img src="${icon}">` } }] } })).toBeUndefined()
    expect(inlineImageProblem({ ogImage: '/_nuxflow/media/site/abc.png' }, undefined, null)).toBeUndefined()
  })
})
