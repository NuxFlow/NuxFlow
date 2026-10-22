import type { SpacingValue } from '../types'

/**
 * Converts a block's `spacing`-type prop value into a CSS `padding` shorthand string, for
 * every block component with a `padding` prop.
 */
export function spacingToCss(padding: SpacingValue | null | undefined, fallback: string): string {
  if (!padding) return fallback
  return `${padding.top}${padding.unit} ${padding.right}${padding.unit} ${padding.bottom}${padding.unit} ${padding.left}${padding.unit}`
}
