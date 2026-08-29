// `defaultLimit` is the page size when the caller passes no `limit` query param.
// `maxLimit` bounds an explicit `?limit=` so callers (e.g. picker widgets that
// want "effectively everything") can raise the page size without removing the
// cap that keeps a single request from pulling an unbounded table scan.
export function parsePagination(query: Record<string, unknown>, defaultLimit = 50, maxLimit = 500) {
  const page = Math.max(1, Number(query.page ?? 1))
  const requestedLimit = Number(query.limit)
  const perPage = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(maxLimit, Math.floor(requestedLimit))
    : defaultLimit
  return { page, perPage, limit: perPage, offset: (page - 1) * perPage }
}
