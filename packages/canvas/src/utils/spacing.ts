import type { SpacingValue } from '../types'

/**
 * The site-wide spacing multiplier the Visual Customizer sets ("Section spacing"). Unset
 * everywhere else (the admin, sites that never chose one), where it counts as 1.
 */
const SPACING_SCALE = 'var(--nuxflow-spacing-scale, 1)'

/** A vertical padding length, multiplied by the site's spacing scale (0 stays 0). */
function scaled(length: string): string {
  return /^0(?:\.0+)?[a-z%]*$/i.test(length) ? length : `calc(${length} * ${SPACING_SCALE})`
}

/** Scales the top and bottom of a 1–4 value `padding` shorthand; anything else is kept as-is. */
function scaleVertical(shorthand: string): string {
  const parts = shorthand.trim().split(/\s+/)
  if (!parts[0] || parts.length > 4) return shorthand
  const [top, right = top, bottom = top, left = right] = parts as [string, string?, string?, string?]
  return `${scaled(top)} ${right} ${scaled(bottom)} ${left}`
}

/**
 * Converts a block's `spacing`-type prop value into a CSS `padding` shorthand string, for
 * every block component with a `padding` prop. The top and bottom are multiplied by
 * `--nuxflow-spacing-scale`, so one site-wide setting tightens or loosens every block.
 */
export function spacingToCss(padding: SpacingValue | null | undefined, fallback: string): string {
  if (!padding) return fallback ? scaleVertical(fallback) : fallback
  const u = padding.unit
  return `${scaled(`${padding.top}${u}`)} ${padding.right}${u} ${scaled(`${padding.bottom}${u}`)} ${padding.left}${u}`
}
