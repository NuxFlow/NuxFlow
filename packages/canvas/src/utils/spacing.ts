import type { SpacingValue } from '../types'

/**
 * Converts a block's `spacing`-type prop value into a CSS `padding` shorthand string.
 * Was previously copy-pasted verbatim (differing only in the fallback string) across every
 * block component that has a `padding` prop — a future change to spacing semantics (e.g. a
 * 5th unit, or negative-value support) would otherwise need updating every call site
 * identically with nothing enforcing they stay in sync.
 */
export function spacingToCss(padding: SpacingValue | null | undefined, fallback: string): string {
  if (!padding) return fallback
  return `${padding.top}${padding.unit} ${padding.right}${padding.unit} ${padding.bottom}${padding.unit} ${padding.left}${padding.unit}`
}
