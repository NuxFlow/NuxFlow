import type { H3Event } from 'h3'
import type { ZodSchema } from 'zod'

export async function parseBody<T>(event: H3Event, schema: ZodSchema<T>): Promise<T> {
  const body = await readBody(event)
  const result = schema.safeParse(body)
  if (!result.success) {
    throw createError({
      statusCode: 422,
      message: 'Validation error',
      data: result.error.flatten(),
    })
  }
  return result.data
}

export function parseQuery<T>(event: H3Event, schema: ZodSchema<T>): T {
  const query = getQuery(event)
  const result = schema.safeParse(query)
  if (!result.success) {
    throw createError({
      statusCode: 422,
      message: 'Validation error',
      data: result.error.flatten(),
    })
  }
  return result.data
}
