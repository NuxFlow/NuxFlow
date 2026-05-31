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

export function notFound(message = 'Not found') {
  throw createError({ statusCode: 404, message })
}

export function unauthorized(message = 'Unauthorized') {
  throw createError({ statusCode: 401, message })
}

export function forbidden(message = 'Forbidden') {
  throw createError({ statusCode: 403, message })
}

export function conflict(message = 'Conflict') {
  throw createError({ statusCode: 409, message })
}

export function validationError(message = 'Validation error', data?: unknown) {
  throw createError({ statusCode: 422, message, data })
}
