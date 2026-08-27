export function parsePagination(query: Record<string, unknown>, perPage = 50) {
  const page = Math.max(1, Number(query.page ?? 1))
  return { page, perPage, limit: perPage, offset: (page - 1) * perPage }
}
