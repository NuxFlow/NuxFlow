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

/**
 * Throws an HTTP error. Every error the server throws on purpose goes through here (or
 * one of the helpers below), written with h3 v2 / Nuxt 5's names (`status`, not
 * `statusCode`), so the move to Nitro v3 — where h3's `createError` becomes
 * `new HTTPError({ status, ... })` — changes only this function.
 */
export function httpError({ status, message, data }: { status: number; message?: string; data?: unknown }): never {
  throw createError({ statusCode: status, message, data })
}

export function badRequest(message = 'Bad request', data?: unknown): never {
  httpError({ status: 400, message, data })
}

export function notFound(message = 'Not found', data?: unknown): never {
  httpError({ status: 404, message, data })
}

export function unauthorized(message = 'Unauthorized', data?: unknown): never {
  httpError({ status: 401, message, data })
}

export function forbidden(message = 'Forbidden', data?: unknown): never {
  httpError({ status: 403, message, data })
}

export function conflict(message = 'Conflict', data?: unknown): never {
  httpError({ status: 409, message, data })
}

export function validationError(message = 'Validation error', data?: unknown): never {
  httpError({ status: 422, message, data })
}
