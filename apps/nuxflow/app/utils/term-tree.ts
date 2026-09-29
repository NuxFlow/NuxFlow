/** A taxonomy as GET /api/v1/taxonomies returns it. */
export interface AdminTaxonomy {
  id: string
  slug: string
  name: string
  description: string | null
  isHierarchical: boolean
  noindex: boolean
  /** Content type slugs it applies to; empty = every type. */
  contentTypes: string[]
  termCount: number
}

/** A term as GET /api/v1/taxonomies/:id/terms returns it. */
export interface AdminTerm {
  id: string
  slug: string
  name: string
  description: string | null
  parentId: string | null
  sortOrder: number
  seoTitle: string | null
  seoDescription: string | null
  ogImage: string | null
  /** Items (any status) tagged with this term directly. */
  count: number
}

export interface TreeTerm {
  id: string
  name: string
  parentId: string | null
  sortOrder?: number
}

function compareTerms(a: TreeTerm, b: TreeTerm): number {
  return (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name)
}

/**
 * Flattens a taxonomy's terms into display order — each parent followed by its children
 * (depth-first), siblings by sortOrder then name — with each term's nesting depth. A term
 * whose parent is missing is treated as top-level, and any term only reachable through a
 * cycle is still listed (at depth 0) rather than dropped.
 */
export function flattenTermTree<T extends TreeTerm>(terms: T[]): (T & { depth: number })[] {
  const ids = new Set(terms.map(t => t.id))
  const childrenOf = new Map<string | null, T[]>()
  for (const t of terms) {
    const key = t.parentId && ids.has(t.parentId) ? t.parentId : null
    const list = childrenOf.get(key)
    if (list) list.push(t)
    else childrenOf.set(key, [t])
  }
  for (const list of childrenOf.values()) list.sort(compareTerms)

  const out: (T & { depth: number })[] = []
  const visited = new Set<string>()
  const visit = (t: T, depth: number) => {
    if (visited.has(t.id)) return
    visited.add(t.id)
    out.push({ ...t, depth })
    for (const child of childrenOf.get(t.id) ?? []) visit(child, depth + 1)
  }
  for (const root of childrenOf.get(null) ?? []) visit(root, 0)
  for (const t of [...terms].sort(compareTerms)) visit(t, 0)
  return out
}

/** `id` plus every term nested under it — the terms a term can't be moved under. */
export function termWithDescendantIds(terms: TreeTerm[], id: string): Set<string> {
  const out = new Set<string>([id])
  let grew = true
  while (grew) {
    grew = false
    for (const t of terms) {
      if (t.parentId && out.has(t.parentId) && !out.has(t.id)) {
        out.add(t.id)
        grew = true
      }
    }
  }
  return out
}

/** Same rule as the server's slugify() (server/utils/taxonomy.ts), for live slug previews. */
export function slugifyTermName(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
}
