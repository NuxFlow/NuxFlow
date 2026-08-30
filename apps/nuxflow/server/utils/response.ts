import type { H3Event } from 'h3'

export function ok<T>(data: T) {
  return data
}

export function created<T>(event: H3Event, data: T) {
  setResponseStatus(event, 201)
  return data
}

export function noContent(event: H3Event) {
  setResponseStatus(event, 204)
  return null
}

export function badRequest(message = 'Bad request'): never {
  throw createError({ statusCode: 400, message })
}

export function notFound(message = 'Not found'): never {
  throw createError({ statusCode: 404, message })
}

export function unauthorized(message = 'Unauthorized'): never {
  throw createError({ statusCode: 401, message })
}

export function forbidden(message = 'Forbidden'): never {
  throw createError({ statusCode: 403, message })
}

export function conflict(message = 'Conflict'): never {
  throw createError({ statusCode: 409, message })
}

export function validationError(message = 'Validation error', data?: unknown): never {
  throw createError({ statusCode: 422, message, data })
}
