/**
 * Block settings are stored under their field `key` (see definitions.ts) and passed to
 * the block component with `v-bind`. Vue reserves `style` and `class` for the element's
 * own inline style/class, so a field with one of those keys never reaches the component
 * as a prop — it becomes an attribute on the root element instead. That silently broke
 * the Features and Testimonial blocks' "Style" option (card / plain / large): the saved
 * value was ignored and the component's default always won.
 *
 * Renaming at render time keeps stored content unchanged (existing pages keep their
 * `style` key) while components receive `blockStyle` / `blockClass`. Used by both
 * renderers: the public NuxBlockResolved.vue and the editor's CanvasBlock.vue.
 */
const RESERVED_PROP_NAMES: Record<string, string> = {
  style: 'blockStyle',
  class: 'blockClass',
}

export function toComponentProps(props: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!props) return {}
  // Own-property checks: `k in obj` would also match inherited names like `constructor`.
  const rename = (k: string) => (Object.hasOwn(RESERVED_PROP_NAMES, k) ? RESERVED_PROP_NAMES[k]! : k)
  if (!Object.keys(props).some(k => Object.hasOwn(RESERVED_PROP_NAMES, k))) return props
  return Object.fromEntries(Object.entries(props).map(([k, v]) => [rename(k), v]))
}
