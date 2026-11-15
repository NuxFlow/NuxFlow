// Server side of the Visual Customizer (the rules and CSS are in
// shared/lib/theme-customizer.ts, shared with the preview).

/** Where the customizer keeps its own values (an object; older installs stored a JSON string). */
export const CUSTOMIZER_VALUES_KEY = 'theme.customizer_values'

/** The stored customizer values as a plain object, whichever form they were saved in. */
export function readStoredCustomizerValues(stored: unknown): Record<string, unknown> {
  let value = stored
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    }
    catch {
      return {}
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
