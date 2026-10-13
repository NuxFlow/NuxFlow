// Shared by the server (server/utils/taxonomy.ts re-exports it) and the browser (the
// WordPress import works out term slugs client-side).

/**
 * URL-safe slug from a display name. Accented Latin letters are folded to their base
 * letter (Café → cafe) so common names don't collapse to an empty slug; a name with no
 * Latin letters or digits at all still returns '' and the caller must ask for a slug.
 */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
}
