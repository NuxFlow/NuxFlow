import type { H3Event } from 'h3'
import type { ZodSchema } from 'zod'

export async function parseBody<T>(event: H3Event, schema: ZodSchema<T>): Promise<T> {
  const body = await readBody(event)
  const result = schema.safeParse(body)
  if (!result.success) {
    validationError('Validation error', result.error.flatten())
  }
  return result.data
}

export function parseQuery<T>(event: H3Event, schema: ZodSchema<T>): T {
  const query = getQuery(event)
  const result = schema.safeParse(query)
  if (!result.success) {
    validationError('Validation error', result.error.flatten())
  }
  return result.data
}

/**
 * Validates a caller-supplied "send the browser back here afterwards" URL: http(s) only,
 * and on the same host this request arrived on. Payment providers redirect to it after
 * checkout/portal, and the free-tier checkout path hands it straight back to the client to
 * navigate to — so an unchecked value is both an open redirect and, with a `javascript:`
 * URL, a script-execution sink.
 */
export function assertSameHostReturnUrl(event: H3Event, url: string): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    validationError('Invalid return URL')
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    validationError('Return URL must be an http(s) URL')
  }
  if (parsed.host !== getRequestURL(event).host) {
    validationError('Return URL must be on this site')
  }
}
