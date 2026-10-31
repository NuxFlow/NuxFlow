import { z } from 'zod'

/**
 * Paths in a generateObject() schema whose `additionalProperties` isn't a boolean — what a
 * `z.record()` produces. DeepSeek rejects it ("Invalid json schema: invalid type: map,
 * expected a boolean") and so does OpenAI's strict mode, so every page/translation failed
 * on DeepSeek while the mocked tests passed. Returns [] when the schema is fine.
 */
export function nonBooleanAdditionalProperties(schema: z.ZodType): string[] {
  const found: string[] = []
  const walk = (node: unknown, path: string) => {
    if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${path}[${i}]`))
    if (typeof node !== 'object' || node === null) return
    for (const [key, value] of Object.entries(node)) {
      if (key === 'additionalProperties' && typeof value !== 'boolean') found.push(path || '(root)')
      walk(value, path ? `${path}.${key}` : key)
    }
  }
  walk(z.toJSONSchema(schema), '')
  return found
}
